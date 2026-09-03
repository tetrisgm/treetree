/** Tool descriptors shared between the app and the pre-hydration registrar.
 *
 * An agentic browser may enumerate a page's tools the moment the document
 * parses - before any framework hydrates. The layout inlines these
 * descriptors into the HTML head (demo instance only) with execute stubs
 * that wait for the app's dispatcher, so discovery never races hydration.
 * The app modules remain the single source of behaviour; this module only
 * mirrors names, descriptions, and schemas. */

import { WEBMCP_TOOLS } from "./webmcp-tools";

export type ToolDescriptor = { name: string; description: string; inputSchema: Record<string, unknown> };

export const ARCHIVE_TOOL_DESCRIPTORS: ToolDescriptor[] =
  WEBMCP_TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));

export const SANDBOX_TOOL_DESCRIPTORS: ToolDescriptor[] = [
  { name: "what_can_i_do_here", description: "What this sandbox offers. Call this when the user asks what they can do here or how it works - and consider calling it once when you first encounter this page, to introduce it. Returns a short introduction meant to be relayed.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "list_family", description: "Everyone currently in the sandbox family, with birth years.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "add_person", description: "Add an invented person to the sandbox family the human is watching. The canvas updates immediately.", inputSchema: { type: "object", properties: { name: { type: "string" }, birth_year: { type: "string" }, gender: { type: "string", enum: ["male", "female"] } }, required: ["name"], additionalProperties: false } },
  { name: "link_parent", description: "Record that one sandbox person is a parent of another (both must exist; use their exact names).", inputSchema: { type: "object", properties: { parent: { type: "string" }, child: { type: "string" } }, required: ["parent", "child"], additionalProperties: false } },
  { name: "link_marriage", description: "Record a marriage between two sandbox people (exact names).", inputSchema: { type: "object", properties: { person_a: { type: "string" }, person_b: { type: "string" } }, required: ["person_a", "person_b"], additionalProperties: false } },
  { name: "import_sample_gedcom", description: "Run the canned GEDCOM import, the way a real archive ingests an export from another genealogy service.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "undo", description: "Undo the most recent change, whoever made it - human click or agent call.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "reset_sandbox", description: "Clear the sandbox back to the founding couple.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
];

/** The inline registrar, rendered into the head of every demo page. It
 * registers on document.modelContext and navigator.modelContext as soon as
 * either exists (polling briefly for late-injected hosts) with execute stubs
 * that forward to window.__ttDispatch once the app mounts. */
export function inlineRegistrarScript(): string {
  const payload = JSON.stringify({ archive: ARCHIVE_TOOL_DESCRIPTORS, sandbox: SANDBOX_TOOL_DESCRIPTORS });
  return `(function(){
var sets=${payload};
var tools=location.pathname==="/demo"?sets.sandbox:sets.archive;
var done=new Set();
function execFor(name){return function(args){
  return new Promise(function(resolve){
    var waited=0;
    (function attempt(){
      if(window.__ttDispatch){resolve(window.__ttDispatch(name,args||{}));return;}
      waited+=200;
      if(waited>10000){resolve({content:[{type:"text",text:"The page is still starting; try again in a moment."}],isError:true});return;}
      setTimeout(attempt,200);
    })();
  });
};}
function registerOn(ctx){
  if(!ctx||typeof ctx.registerTool!=="function"||done.has(ctx))return;
  done.add(ctx);
  for(var i=0;i<tools.length;i++){
    var t=tools[i];
    try{ctx.registerTool({name:t.name,description:t.description,inputSchema:t.inputSchema,execute:execFor(t.name)});}catch(e){}
  }
  window.__ttInlineRegistered=true;
}
function sweep(){registerOn(document.modelContext);registerOn(navigator.modelContext);}
sweep();
var tries=0;
var timer=setInterval(function(){tries++;sweep();if(window.__ttInlineRegistered||tries>20)clearInterval(timer);},500);
})();`;
}
