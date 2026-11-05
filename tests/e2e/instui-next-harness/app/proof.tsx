'use client';
import { useState, useRef } from 'react';
import { CanvasProvider, CanvasButton, CanvasTextInput, CanvasTextArea, CanvasSelect, CanvasCheckbox, CanvasAlert, CanvasLink } from '@/features/canvas/ui';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/dropdown-menu';
export function ClientProof() {
 const [name,setName]=useState('Academy'); const [note,setNote]=useState('Draft'); const [locale,setLocale]=useState('en'); const [checked,setChecked]=useState(false); const [count,setCount]=useState(0); const [dark,setDark]=useState(false); const ref=useRef<HTMLButtonElement>(null);
 return <CanvasProvider theme={dark?'dark':'light'}><section style={{padding:24}}>
 <CanvasButton onClick={()=>setCount(count+1)}>Count {count}</CanvasButton><CanvasButton variant="secondary" onClick={()=>setDark(!dark)}>Switch theme</CanvasButton>
 <CanvasButton variant="outline"><svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true"><path d="M1 10h18" /></svg>Icon action</CanvasButton>
 <CanvasTextInput renderLabel="Course title" value={name} onChange={setName}/><CanvasTextArea label="Draft notes" value={note} onChange={setNote}/><CanvasSelect label="Content language" value={locale} options={[{value:'en',label:'English'},{value:'vi',label:'Tiếng Việt'}]} onChange={setLocale}/><CanvasCheckbox label="Required" checked={checked} onChange={setChecked}/><CanvasAlert variant="info">Draft retained</CanvasAlert><CanvasLink href="#destination">Preview content</CanvasLink>
 <DropdownMenu><DropdownMenuTrigger asChild><CanvasButton ref={ref} variant="outline">Actions</CanvasButton></DropdownMenuTrigger><DropdownMenuContent><DropdownMenuItem>Export draft</DropdownMenuItem></DropdownMenuContent></DropdownMenu><p id="destination">{name} · {note} · {locale} · {checked?'Required':'Optional'}</p></section></CanvasProvider>;
}
