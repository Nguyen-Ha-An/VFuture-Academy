// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { useEffect } from "react";
import Link from "next/link";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, expect, it, vi } from "vitest";
import { ResourceDocumentSchema } from "@/content-engine/schema/bundle";
import { ResourceEditor } from "@/features/resources/ui/ResourceEditor";
import en from "@/messages/en.json";
import { staffUiTestMessages } from "@/messages/staff-ui";

const messages = staffUiTestMessages(en, "en");
const navigation = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => navigation,
}));
vi.mock("@/features/ecosystem/ui/StaticRichContent", () => ({
  StaticRichContent: () => null,
}));
vi.mock("@/features/content-review/ContentWorkflowPanel", () => ({
  ContentWorkflowPanel: ({
    onLockChange,
    beforeSubmit,
  }: {
    onLockChange: (v: boolean) => void;
    beforeSubmit: () => Promise<boolean>;
  }) => {
    useEffect(() => onLockChange(false), [onLockChange]);
    return <button onClick={() => void beforeSubmit()}>Submit review</button>;
  },
}));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
const doc = ResourceDocumentSchema.parse({
  schemaVersion: 1,
  kind: "resource",
  id: "guide",
  languages: ["vi", "en"],
  defaultLanguage: "vi",
  title: { vi: "Hướng dẫn", en: "Guide" },
  summary: { vi: "Tóm tắt", en: "Summary" },
  resourceType: "guide",
  tags: [],
  skills: [],
  pathways: [],
  body: { blocks: [{ type: "paragraph", content: [{ text: "Body" }] }] },
});
it('saves the latest source before leaving while an older autosave is pending', async () => {
  const releases: Array<(response: Response) => void> = [];
  const request = vi.fn(() => new Promise<Response>(resolve => releases.push(resolve)));
  vi.stubGlobal('fetch', request);
  render(<NextIntlClientProvider locale="en" messages={messages}><Link href="/studio">Leave editor</Link><ResourceEditor canPublish={false} initialDocument={doc} initialRecord={{ownerId:'author',id:'guide',document:doc,status:'draft',updatedAt:'2026-09-08T00:00:00Z',publishedAt:null}} /></NextIntlClientProvider>);
  const editor = screen.getByRole('textbox',{name:'Resource JSON'});
  const first = JSON.stringify({...doc,title:{vi:'Hướng dẫn',en:'Older'}});
  const second = JSON.stringify({...doc,title:{vi:'Hướng dẫn',en:'Latest'}});
  fireEvent.change(editor,{target:{value:first}});
  fireEvent.click(screen.getByRole('button',{name:'Save now'}));
  fireEvent.change(editor,{target:{value:second}});
  fireEvent.click(screen.getByRole('link',{name:'Leave editor'}));
  fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button',{name:messages.studioWorkspace.save}));
  const response = (source:string, minute:number) => new Response(JSON.stringify({data:{id:'guide',document:JSON.parse(source),status:'draft',updatedAt:`2026-09-08T00:0${minute}:00Z`,publishedAt:null}}),{status:200});
  await act(async () => { releases[0](response(first,1)); });
  await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
  expect(navigation.push).not.toHaveBeenCalled();
  await act(async () => { releases[1](response(second,2)); });
  await waitFor(() => expect(navigation.push).toHaveBeenCalledWith('/studio'));
});
it("confirms save without replacing edits typed during its request and never publishes from editor", async () => {
  let finish!: (r: Response) => void;
  const fetcher = vi.fn().mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  vi.stubGlobal("fetch", fetcher);
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <ResourceEditor
        initialDocument={doc}
        initialRecord={{
          ownerId: "author",
          id: "guide",
          document: doc,
          status: "draft",
          updatedAt: "2026-09-08T00:00:00Z",
          publishedAt: null,
        }}
        canPublish
      />
    </NextIntlClientProvider>,
  );
  const editor = screen.getByRole("textbox", { name: "Resource JSON" });
  const first = JSON.stringify({
    ...doc,
    title: { vi: "Hướng dẫn", en: "First" },
  });
  fireEvent.change(editor, { target: { value: first } });
  fireEvent.click(screen.getByRole("button", { name: "Save now" }));
  expect(editor).not.toBeDisabled();
  const second = JSON.stringify({
    ...doc,
    title: { vi: "Hướng dẫn", en: "Second" },
  });
  fireEvent.change(editor, { target: { value: second } });
  finish(
    new Response(
      JSON.stringify({
        data: {
          id: "guide",
          document: JSON.parse(first),
          status: "draft",
          updatedAt: "2026-09-08T00:01:00Z",
          publishedAt: null,
        },
      }),
      { status: 200 },
    ),
  );
  await waitFor(() =>
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument(),
  );
  expect(editor).toHaveValue(second);
  expect(fetcher.mock.calls[0][1].method).toBe("PUT");
  expect(screen.queryByRole("button", { name: /publish/i })).toBeNull();
  // Section cards group the fields; the editor has exactly one save indicator.
  expect(screen.getByRole("region", { name: "Details" })).toBeInTheDocument();
  expect(screen.getByRole("region", { name: "Audience and learning" })).toBeInTheDocument();
  expect(screen.getByRole("region", { name: "Status and audience" })).toBeInTheDocument();
  expect(screen.getByRole("region", { name: "Attachments" })).toBeInTheDocument();
  expect(screen.getAllByRole("button", { name: "Save now" })).toHaveLength(1);
});

it("opens one scoped leave dialog for unsaved editor work", async () => {
  vi.stubGlobal("fetch", vi.fn());
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <ResourceEditor
        initialDocument={doc}
        initialRecord={{ ownerId: "author", id: "guide", document: doc, status: "draft", updatedAt: "2026-09-08T00:00:00Z", publishedAt: null }}
        canPublish
      />
      <Link href="/studio/resources">Leave editor</Link>
    </NextIntlClientProvider>,
  );

  fireEvent.change(screen.getByRole("textbox", { name: "Resource JSON" }), {
    target: { value: JSON.stringify({ ...doc, title: { vi: "Hướng dẫn", en: "Changed" } }) },
  });
  fireEvent.click(screen.getByRole("link", { name: "Leave editor" }));

  await waitFor(() => expect(screen.getAllByRole("dialog")).toHaveLength(1));
});
