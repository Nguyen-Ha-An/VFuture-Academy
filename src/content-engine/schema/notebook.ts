import { z } from 'zod';

export const NOTEBOOK_MIME = 'application/x-ipynb+json' as const;
export const NOTEBOOK_MAX_BYTES = 5 * 1024 * 1024;
export const NOTEBOOK_DATASET_MAX_BYTES = 10 * 1024 * 1024;
export const NOTEBOOK_DATASETS_TOTAL_MAX_BYTES = 20 * 1024 * 1024;
export const NOTEBOOK_RUNTIME_PROFILES = {
  jupyterlite: { id: 'python-data-v1', version: '1' },
  colab_external: { id: 'colab-python-data-v1', version: '1' },
} as const;

export const ChecksumSchema = z.string().regex(/^[0-9a-f]{64}$/, 'checksum must be a lowercase SHA-256 hex digest');
const AssetIdSchema = z.string().min(1).max(80);

export const NotebookDatasetSchema = z.object({
  assetId: AssetIdSchema,
  checksum: ChecksumSchema,
  filename: z.string().min(1).max(255).regex(/^[^/\\]+\.(csv|json)$/i, 'dataset filename must end in .csv or .json'),
}).strict();

const NotebookAssignmentFields = {
  templateAssetId: AssetIdSchema,
  templateChecksum: ChecksumSchema,
  datasets: z.array(NotebookDatasetSchema).max(20).default([]),
};
const JupyterLiteAssignmentSchema = z.object({
  ...NotebookAssignmentFields,
  runtimeMode: z.literal('jupyterlite').default('jupyterlite'),
  runtimeProfileId: z.literal('python-data-v1').default('python-data-v1'),
  runtimeProfileVersion: z.literal('1').default('1'),
  colabReason: z.string().trim().min(1).max(2_000).optional(),
}).strict();
const ColabAssignmentSchema = z.object({
  ...NotebookAssignmentFields,
  runtimeMode: z.literal('colab_external'),
  runtimeProfileId: z.literal('colab-python-data-v1').default('colab-python-data-v1'),
  runtimeProfileVersion: z.literal('1').default('1'),
  colabReason: z.string().trim().min(1).max(2_000),
}).strict();

export const NotebookAssignmentSchema = z.union([JupyterLiteAssignmentSchema, ColabAssignmentSchema]).superRefine((notebook, context) => {
  const datasets = notebook.datasets ?? [];
  const assetIds = new Set<string>();
  const filenames = new Set<string>();
  datasets.forEach((dataset, index) => {
    if (assetIds.has(dataset.assetId)) context.addIssue({ code: 'custom', path: ['datasets', index, 'assetId'], message: 'dataset assetId must be unique' });
    if (filenames.has(dataset.filename)) context.addIssue({ code: 'custom', path: ['datasets', index, 'filename'], message: 'dataset filename must be unique' });
    assetIds.add(dataset.assetId);
    filenames.add(dataset.filename);
  });
});

export type NotebookAssignment = z.infer<typeof NotebookAssignmentSchema>;
export type NotebookDataset = z.infer<typeof NotebookDatasetSchema>;

const NotebookSourceSchema = z.union([z.string(), z.array(z.string())]);
const NotebookMetadataSchema = z.record(z.string(), z.unknown());
const CellBase = {
  id: z.string().min(1).max(64).optional(),
  metadata: NotebookMetadataSchema,
  source: NotebookSourceSchema,
};
const CodeCellSchema = z.object({
  ...CellBase,
  cell_type: z.literal('code'),
  execution_count: z.number().int().nonnegative().nullable().optional(),
  outputs: z.array(z.unknown()).optional(),
}).strict();
const MarkdownCellSchema = z.object({
  ...CellBase,
  cell_type: z.literal('markdown'),
  attachments: z.record(z.string(), z.unknown()).optional(),
}).strict();
const RawCellSchema = z.object({
  ...CellBase,
  cell_type: z.literal('raw'),
  attachments: z.record(z.string(), z.unknown()).optional(),
}).strict();

export const NotebookDocumentSchema = z.object({
  nbformat: z.literal(4),
  nbformat_minor: z.number().int().nonnegative(),
  metadata: NotebookMetadataSchema,
  cells: z.array(z.discriminatedUnion('cell_type', [CodeCellSchema, MarkdownCellSchema, RawCellSchema])),
}).strict();
export type NotebookDocument = z.infer<typeof NotebookDocumentSchema>;
