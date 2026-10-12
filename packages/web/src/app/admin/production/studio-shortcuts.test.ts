import {expect,test} from "bun:test";
import {Window} from "happy-dom";
import {allowsStudioShortcut,matchStudioShortcut,studioLayerOpen,studioSaveChord,studioShortcutProps} from "./studio-shortcuts";

function key(key:string,patch:Partial<KeyboardEvent>={},altGraph=false) {
  return {key,shiftKey:false,metaKey:false,ctrlKey:false,altKey:false,repeat:false,isComposing:false,defaultPrevented:false,getModifierState:(modifier:string)=>modifier==="AltGraph" && altGraph,...patch};
}
test("Studio matching preserves browser chords, composition and character preference",()=>{
  expect(matchStudioShortcut(key("M"),true)?.id).toBe("mute");
  expect(matchStudioShortcut(key("?",{shiftKey:true}),true)?.id).toBe("help");
  expect(matchStudioShortcut(key("?"),true)?.id).toBe("help");
  for (const character of ["m","f","1","2","/","t","r","e","?","[","]"]) expect(matchStudioShortcut(key(character),false)).toBeUndefined();
  expect(matchStudioShortcut(key(" "),false)?.id).toBe("play");
  expect(matchStudioShortcut(key("ArrowRight",{shiftKey:true}),false)?.id).toBe("nextSecond");
  for (const patch of [{metaKey:true},{ctrlKey:true},{altKey:true},{isComposing:true},{defaultPrevented:true},{shiftKey:true}]) expect(matchStudioShortcut(key("f",patch),true)).toBeUndefined();
  expect(matchStudioShortcut(key("e",{},true),true)).toBeUndefined();
  expect(matchStudioShortcut(key("Escape"),true)).toBeUndefined();
});
test("only frame and second commands repeat; Save uses the platform chord once",()=>{
  for (const name of ["ArrowLeft","ArrowRight"]) for (const shiftKey of [true,false]) expect(matchStudioShortcut(key(name,{repeat:true,shiftKey}),true)).toBeDefined();
  for (const name of [" ","m","f","1","2","/","t","r","e","?","[","]","Home","End"]) expect(matchStudioShortcut(key(name,{repeat:true}),true)).toBeUndefined();
  expect(studioSaveChord(key("Enter",{metaKey:true}),true)).toBe(true);
  expect(studioSaveChord(key("Enter",{ctrlKey:true}),false)).toBe(true);
  expect(studioSaveChord(key("Enter",{ctrlKey:true}),true)).toBe(false);
  expect(studioSaveChord(key("Enter",{metaKey:true}),false)).toBe(false);
  for (const patch of [{repeat:true},{isComposing:true},{altKey:true},{shiftKey:true},{metaKey:true},{defaultPrevented:true}]) expect(studioSaveChord(key("Enter",{ctrlKey:true,...patch}),false)).toBe(false);
  expect(studioSaveChord(key("Enter",{ctrlKey:true},true),false)).toBe(false);
});
test("editable descendants and native controls retain their keys",()=>{
  const dom = new Window();
  try {
    dom.document.body.innerHTML='<div id="stage"></div><button><span>Play</span></button><a href="/">Library</a><details><summary>Metadata</summary></details><div contenteditable="true"><b>Copy</b></div><div contenteditable="false">Static</div>';
    const stage=dom.document.getElementById("stage")! as unknown as Element;
    expect(allowsStudioShortcut(stage," ")).toBe(true);
    const button=dom.document.querySelector("button span")! as unknown as Element;
    expect(allowsStudioShortcut(button," ")).toBe(false);
    expect(allowsStudioShortcut(button,"m")).toBe(true);
    expect(allowsStudioShortcut(dom.document.querySelector("a")! as unknown as Element," ")).toBe(false);
    expect(allowsStudioShortcut(dom.document.querySelector("summary")! as unknown as Element," ")).toBe(false);
    expect(allowsStudioShortcut(dom.document.querySelector("b")! as unknown as Element,"e")).toBe(false);
    expect(allowsStudioShortcut(dom.document.querySelector('[contenteditable="false"]')! as unknown as Element,"e")).toBe(true);
    for (const tag of ["input","textarea","select"]) for (const type of ["text","checkbox","range"]) {
      const node=dom.document.createElement(tag); node.setAttribute("type",type);
      for (const name of [" ","ArrowLeft","Home","e"]) expect(allowsStudioShortcut(node as unknown as Element,name)).toBe(false);
    }
    for (const role of ["textbox","searchbox","spinbutton","combobox","listbox","slider","separator","menu","menubar","tree","grid"]) {
      const node=dom.document.createElement("div"); node.setAttribute("role",role); node.innerHTML="<span>Child</span>";
      expect(allowsStudioShortcut(node.firstElementChild! as unknown as Element,"ArrowRight")).toBe(false);
      expect(allowsStudioShortcut(node.firstElementChild! as unknown as Element,"f")).toBe(false);
    }
  } finally {dom.close();}
});
test("visible modal and menu layers suspend workspace commands; hints respect disabling",()=>{
  const dom=new Window();
  try {
    const document=dom.document as unknown as Document;
    expect(studioLayerOpen(document)).toBe(false);
    for (const markup of ['<dialog open></dialog>','<div role="dialog" aria-modal="true"></div>','<div role="listbox"></div>','<div role="menu"></div>']) {
      dom.document.body.innerHTML=markup;
      Object.defineProperty(dom.document.body.firstElementChild!,"getClientRects",{configurable:true,value:()=>[]});
      expect(studioLayerOpen(document)).toBe(false);
      Object.defineProperty(dom.document.body.firstElementChild!,"getClientRects",{value:()=>[{}]});
      expect(studioLayerOpen(document)).toBe(true);
    }
    expect(studioShortcutProps("mute",false)["aria-keyshortcuts"]).toBeUndefined();
    expect(studioShortcutProps("mute",false).title).not.toContain("(M)");
    expect(studioShortcutProps("mute",true)["aria-keyshortcuts"]).toBe("m");
    expect(studioShortcutProps("nextFrame",false)["aria-keyshortcuts"]).toBe("ArrowRight");
  } finally {dom.close();}
});
