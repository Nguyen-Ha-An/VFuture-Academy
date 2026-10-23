import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';
import { IDocumentManager } from '@jupyterlab/docmanager';
import {
  INotebookTracker,
  NotebookActions,
  NotebookPanel
} from '@jupyterlab/notebook';
import { Contents } from '@jupyterlab/services';

const CHANNEL = 'vfuture:notebook:v1';
const VERSION = 1;
const NOTEBOOK_LIMIT = 5 * 1024 * 1024;
const DATASETS_LIMIT = 20 * 1024 * 1024;
const CHANGE_DEBOUNCE_MS = 250;
const HELLO_INTERVAL_MS = 500;
const SESSION_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;
const DATASET_PATTERN = /^(?!\.)(?!.*(?:^|\/)\.\.?\/)[A-Za-z0-9][A-Za-z0-9._/-]{0,254}$/;

type DatasetFormat = 'text' | 'base64';

interface DatasetPayload {
  filename: string;
  content: string;
  format: DatasetFormat;
}

interface InitPayload {
  notebook: Record<string, unknown>;
  datasets: DatasetPayload[];
  readOnly?: boolean;
}

interface RequestMessage {
  channel: typeof CHANNEL;
  version: typeof VERSION;
  session: string;
  id: string;
  type: string;
  payload?: unknown;
}

interface RuntimeConfig {
  allowedParentOrigins: string[];
}

class ProtocolError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}

const utf8Size = (value: unknown): number =>
  new TextEncoder().encode(
    typeof value === 'string' ? value : JSON.stringify(value)
  ).byteLength;

const base64DecodedSize = (value: string): number => {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4 !== 0) {
    throw new ProtocolError('INVALID_PAYLOAD', 'Dataset contains invalid base64.');
  }
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  return (value.length / 4) * 3 - padding;
};

const isNotebook = (value: unknown): value is Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const notebook = value as Record<string, unknown>;
  return (
    notebook.nbformat === 4 &&
    typeof notebook.nbformat_minor === 'number' &&
    Array.isArray(notebook.cells) &&
    !!notebook.metadata &&
    typeof notebook.metadata === 'object'
  );
};

const parseInit = (value: unknown): InitPayload => {
  if (!value || typeof value !== 'object') {
    throw new ProtocolError('INVALID_PAYLOAD', 'INIT payload must be an object.');
  }
  const payload = value as Partial<InitPayload>;
  if (!isNotebook(payload.notebook)) {
    throw new ProtocolError('INVALID_PAYLOAD', 'Notebook must be nbformat 4.');
  }
  if (utf8Size(payload.notebook) > NOTEBOOK_LIMIT) {
    throw new ProtocolError('PAYLOAD_TOO_LARGE', 'Notebook exceeds 5 MiB.');
  }
  if (!Array.isArray(payload.datasets)) {
    throw new ProtocolError('INVALID_PAYLOAD', 'datasets must be an array.');
  }
  let total = 0;
  for (const dataset of payload.datasets) {
    if (
      !dataset ||
      typeof dataset.filename !== 'string' ||
      !DATASET_PATTERN.test(dataset.filename) ||
      typeof dataset.content !== 'string' ||
      (dataset.format !== 'text' && dataset.format !== 'base64')
    ) {
      throw new ProtocolError('INVALID_PAYLOAD', 'A dataset entry is invalid.');
    }
    total +=
      dataset.format === 'base64'
        ? base64DecodedSize(dataset.content)
        : utf8Size(dataset.content);
    if (total > DATASETS_LIMIT) {
      throw new ProtocolError('PAYLOAD_TOO_LARGE', 'Datasets exceed 20 MiB.');
    }
  }
  return {
    notebook: payload.notebook,
    datasets: payload.datasets,
    readOnly: payload.readOnly === true
  };
};

class NotebookBridge {
  private session: string | null = null;
  private activeOrigin: string | null = null;
  private panel: NotebookPanel | null = null;
  private writtenPaths: string[] = [];
  private changeTimer: number | null = null;
  private helloTimer: number | null = null;
  private suppressChanges = false;

  constructor(
    private readonly app: JupyterFrontEnd,
    private readonly documents: IDocumentManager,
    private readonly notebooks: INotebookTracker,
    private readonly allowedOrigins: readonly string[]
  ) {}

  start(): void {
    window.addEventListener('message', this.onMessage);
    this.post('HELLO', null, {
      actions: [
        'INIT',
        'RUN_SELECTED',
        'RUN_ALL',
        'INTERRUPT',
        'RESTART',
        'EXPORT',
        'DOWNLOAD',
        'DISPOSE',
        'PING'
      ],
      limits: { notebookBytes: NOTEBOOK_LIMIT, datasetBytes: DATASETS_LIMIT }
    });
    this.helloTimer = window.setInterval(() => {
      if (!this.session) {
        this.post('HELLO', null, {
          actions: [
            'INIT',
            'RUN_SELECTED',
            'RUN_ALL',
            'INTERRUPT',
            'RESTART',
            'EXPORT',
            'DOWNLOAD',
            'DISPOSE',
            'PING'
          ],
          limits: { notebookBytes: NOTEBOOK_LIMIT, datasetBytes: DATASETS_LIMIT }
        });
      }
    }, HELLO_INTERVAL_MS);
  }

  private readonly onMessage = (event: MessageEvent): void => {
    if (
      event.source !== window.parent ||
      !this.allowedOrigins.includes(event.origin) ||
      (this.activeOrigin !== null && event.origin !== this.activeOrigin)
    ) {
      return;
    }
    const message = event.data as Partial<RequestMessage>;
    if (
      !message ||
      message.channel !== CHANNEL ||
      message.version !== VERSION ||
      typeof message.id !== 'string' ||
      message.id.length < 1 ||
      message.id.length > 128 ||
      typeof message.session !== 'string' ||
      !SESSION_PATTERN.test(message.session) ||
      typeof message.type !== 'string'
    ) {
      return;
    }
    if (message.type !== 'INIT' && message.session !== this.session) {
      this.respond(message as RequestMessage, false, undefined, {
        code: 'INVALID_SESSION',
        message: 'Session nonce does not match the active session.'
      });
      return;
    }
    void this.dispatch(message as RequestMessage, event.origin);
  };

  private async dispatch(message: RequestMessage, requestOrigin: string): Promise<void> {
    try {
      let result: unknown;
      switch (message.type) {
        case 'INIT':
          result = await this.initialize(
            message.session,
            parseInit(message.payload),
            requestOrigin
          );
          break;
        case 'RUN_SELECTED':
          await this.ensureKernel();
          result = await NotebookActions.run(
            this.requirePanel().content,
            this.requirePanel().sessionContext
          );
          break;
        case 'RUN_ALL':
          await this.ensureKernel();
          result = await NotebookActions.runAll(
            this.requirePanel().content,
            this.requirePanel().sessionContext
          );
          break;
        case 'INTERRUPT':
          await this.requireKernel().interrupt();
          result = { interrupted: true };
          break;
        case 'RESTART':
          await this.ensureKernel();
          result = { restarted: await this.requirePanel().sessionContext.restartKernel() };
          this.ready('kernel');
          break;
        case 'EXPORT':
          result = { notebook: this.snapshot() };
          break;
        case 'DOWNLOAD': {
          const notebook = this.requirePanel().context.model.toJSON() as Record<string, unknown>;
          const options = (message.payload ?? {}) as { filename?: string; provenance?: Record<string, unknown> };
          const filename = options.filename ?? 'notebook.ipynb';
          if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,95}\.ipynb$/.test(filename)) throw new ProtocolError('INVALID_PAYLOAD', 'Invalid download filename');
          if (options.provenance) notebook.metadata = {...(notebook.metadata as object), vfuture: options.provenance};
          const url = URL.createObjectURL(new Blob([JSON.stringify(notebook, null, 2)], {type:'application/x-ipynb+json'}));
          const link = document.createElement('a'); link.href = url; link.download = filename; link.click();
          window.setTimeout(() => URL.revokeObjectURL(url), 1000);
          result = {downloaded:true};
          break;
        }
        case 'DISPOSE':
          await this.disposeSession();
          result = { disposed: true };
          break;
        case 'PING':
          result = { ready: !!this.panel, kernel: !!this.panel?.sessionContext.session?.kernel };
          break;
        default:
          throw new ProtocolError('INVALID_PAYLOAD', 'Unknown fixed action.');
      }
      this.respond(message, true, result, undefined, requestOrigin);
    } catch (error) {
      const protocolError =
        error instanceof ProtocolError
          ? error
          : new ProtocolError(
              'ACTION_FAILED',
              error instanceof Error ? error.message : 'Notebook action failed.'
            );
      this.respond(
        message,
        false,
        undefined,
        { code: protocolError.code, message: protocolError.message },
        requestOrigin
      );
    }
  }

  private async initialize(
    session: string,
    payload: InitPayload,
    requestOrigin: string
  ): Promise<object> {
    await this.disposeSession();
    this.session = session;
    this.activeOrigin = requestOrigin;
    this.suppressChanges = true;
    try {

      for (const dataset of payload.datasets) {
        const path = dataset.filename;
        await this.ensureParentDirectories(path);
        await this.app.serviceManager.contents.save(path, {
          type: 'file',
          format: dataset.format,
          content: dataset.content
        });
        this.writtenPaths.push(path);
      }
      const path = 'notebook.ipynb';
      await this.app.serviceManager.contents.save(path, {
        type: 'notebook',
        format: 'json',
        content: payload.notebook
      });
      this.writtenPaths.push(path);
      const widget = this.documents.openOrReveal(path, 'Notebook', {name: 'python'});
      if (!(widget instanceof NotebookPanel)) {
        throw new ProtocolError('ACTION_FAILED', 'Notebook panel could not be opened.');
      }
      this.panel = widget;
      await widget.context.ready;
      widget.context.model.readOnly = payload.readOnly ?? false;
      widget.context.model.contentChanged.connect(this.onContentChanged);
      this.app.shell.activateById(widget.id);
      this.ready('document');
      return { path, readOnly: widget.context.model.readOnly };
    } finally {
      this.suppressChanges = false;
    }
  }

  private async ensureDirectory(path: string): Promise<void> {
    try {
      await this.app.serviceManager.contents.get(path, { content: false });
    } catch {
      await this.app.serviceManager.contents.newUntitled({
        path: path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '',
        type: 'directory'
      }).then(async model => {
        const created = model.path;
        if (created !== path) {
          await this.app.serviceManager.contents.rename(created, path);
        }
      });
      this.writtenPaths.push(path);
    }
  }

  private async ensureParentDirectories(path: string): Promise<void> {
    const parts = path.split('/').slice(0, -1);
    let current = '';
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      await this.ensureDirectory(current);
    }
  }

  private async ensureKernel(): Promise<void> {
    const panel = this.requirePanel();
    await panel.sessionContext.ready;
    if (!panel.sessionContext.session?.kernel) {
      const specs = await this.app.serviceManager.kernelspecs.ready.then(
        () => this.app.serviceManager.kernelspecs.specs
      );
      const name =
        specs?.default && specs.kernelspecs[specs.default]
          ? specs.default
          : Object.keys(specs?.kernelspecs ?? {})[0];
      if (!name) {
        throw new ProtocolError('ACTION_FAILED', 'No Python kernel is available.');
      }
      await panel.sessionContext.changeKernel({ name });
      await panel.sessionContext.ready;
      this.ready('kernel', name);
    }
  }

  private requirePanel(): NotebookPanel {
    if (!this.session) {
      throw new ProtocolError('NOT_INITIALIZED', 'INIT is required first.');
    }
    if (!this.panel || this.panel.isDisposed) {
      throw new ProtocolError('NO_ACTIVE_NOTEBOOK', 'No active notebook is open.');
    }
    return this.panel;
  }

  private requireKernel() {
    const kernel = this.requirePanel().sessionContext.session?.kernel;
    if (!kernel) {
      throw new ProtocolError('ACTION_FAILED', 'No kernel is running.');
    }
    return kernel;
  }

  private readonly onContentChanged = (): void => {
    if (this.suppressChanges || !this.session) {
      return;
    }
    if (this.changeTimer !== null) {
      window.clearTimeout(this.changeTimer);
    }
    this.changeTimer = window.setTimeout(() => {
      this.changeTimer = null;
      try {
        this.post('CHANGED', this.session, { notebook: this.snapshot() });
      } catch (error) {
        this.post('ERROR', this.session, {code:'PAYLOAD_TOO_LARGE', message: error instanceof Error ? error.message : 'Notebook too large'});
      }
    }, CHANGE_DEBOUNCE_MS);
  };

  private snapshot(): Record<string, unknown> {
    const notebook = this.requirePanel().context.model.toJSON() as Record<
      string,
      unknown
    >;
    if (utf8Size(notebook) > NOTEBOOK_LIMIT) {
      throw new ProtocolError(
        'PAYLOAD_TOO_LARGE',
        'Notebook snapshot exceeds 5 MiB.'
      );
    }
    return notebook;
  }

  private async disposeSession(): Promise<void> {
    if (this.changeTimer !== null) {
      window.clearTimeout(this.changeTimer);
      this.changeTimer = null;
    }
    if (this.panel && !this.panel.isDisposed) {
      this.panel.context.model.contentChanged.disconnect(this.onContentChanged);
      await this.panel.sessionContext.shutdown().catch(() => undefined);
      this.panel.dispose();
    }
    this.panel = null;
    for (const path of [...this.writtenPaths].sort((a, b) => b.length - a.length)) {
      await this.app.serviceManager.contents.delete(path).catch(() => undefined);
    }
    this.writtenPaths = [];
    this.session = null;
    this.activeOrigin = null;
  }

  private ready(phase: 'document' | 'kernel', kernelName?: string): void {
    this.post('READY', this.session, {
      phase,
      path: 'notebook.ipynb',
      ...(kernelName ? { kernelName } : {})
    });
  }

  private respond(
    request: RequestMessage,
    ok: boolean,
    result?: unknown,
    error?: { code: string; message: string },
    targetOrigin?: string
  ): void {
    this.post(
      'RESPONSE',
      request.session,
      { id: request.id, ok, ...(ok ? { result } : { error }) },
      targetOrigin
    );
  }

  private post(
    type: string,
    session: string | null,
    payload: unknown,
    targetOrigin?: string
  ): void {
    const message = type === 'RESPONSE'
      ? { channel: CHANNEL, version: VERSION, session, type, ...(payload as object) }
      : { channel: CHANNEL, version: VERSION, session, type, payload };
    const targets = targetOrigin
      ? [targetOrigin]
      : this.activeOrigin
        ? [this.activeOrigin]
        : this.allowedOrigins;
    for (const origin of targets) {
      window.parent.postMessage(message, origin);
    }
  }
}

const plugin: JupyterFrontEndPlugin<void> = {
  id: '@vfuture/notebook-bridge:plugin',
  autoStart: true,
  requires: [IDocumentManager, INotebookTracker],
  activate: async (
    app: JupyterFrontEnd,
    documents: IDocumentManager,
    notebooks: INotebookTracker
  ): Promise<void> => {
    const configUrl = new URL(
      'vfuture-runtime-config.json',
      document.querySelector('base')?.href ?? window.location.href
    );
    const response = await fetch(configUrl.toString(), {
      credentials: 'omit',
      cache: 'no-store'
    });
    if (!response.ok) {
      throw new Error('VFuture runtime origin configuration is unavailable.');
    }
    const config = (await response.json()) as RuntimeConfig;
    if (
      !Array.isArray(config.allowedParentOrigins) ||
      config.allowedParentOrigins.length < 1
    ) {
      throw new Error('VFuture runtime allowed parent origin is invalid.');
    }
    const origins = config.allowedParentOrigins.map(value => new URL(value).origin);
    if (
      new Set(origins).size !== origins.length ||
      origins.some((origin, index) => origin !== config.allowedParentOrigins[index])
    ) {
      throw new Error('VFuture runtime allowed parent origin is invalid.');
    }
    new NotebookBridge(app, documents, notebooks, origins).start();
  }
};

export default plugin;
