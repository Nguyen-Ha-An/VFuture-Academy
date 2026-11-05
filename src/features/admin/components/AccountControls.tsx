'use client';
import { useEffect,useRef,useState,type FormEvent } from 'react';
import { useLocale } from 'next-intl';
import { CanvasButton as Button, CanvasTextInput } from '@/features/canvas/ui';
import { DataCard } from '@/features/staff-ui/components';
import type { AdminScope } from '@/lib/admin-scope';
import { scopedUrl,responseData,RequestStatus,ConfirmationDialog } from './member-admin-ui';

type State={userId:string;status:'active'|'disabled'|'deleted';operation:{id:string;action:string}|null};
type Props={scope:AdminScope;actorId?:string;userId?:string;onChanged:()=>Promise<void>};
const copy={
 en:{title:'Account login',create:'Create email backup account',name:'Display name',email:'Email',intro:'For Google sign-in, use Invite member so the person can register with Google. This creates a separate email/password backup account and does not link Google by matching email.',created:'Account created. Ask the owner to use Forgot password on the email sign-in page. No password is shared with administrators.',disable:'Disable login',enable:'Enable login',remove:'Delete login',retry:'Retry pending change',pending:'A directory change is pending. Retry the same operation to finish it safely.',deleted:'Login deleted. Academic records and history are retained.',failure:'The change could not finish. Reload account status, then retry the pending operation. Your own and the last Central Admin account are protected.',saved:'Account updated.',confirm:'Delete this login?',description:'This blocks Academy access, revokes sessions and deletes only the mapped customer-directory login. Academic records, roles and audit history remain. Corporate Microsoft accounts are never deleted. Type DELETE LOGIN to confirm.',confirmLabel:'Confirmation',cancel:'Cancel',loading:'Working…',active:'Enabled',disabled:'Disabled',reload:'Reload account status'},
 vi:{title:'Đăng nhập tài khoản',create:'Tạo tài khoản email dự phòng',name:'Tên hiển thị',email:'Email',intro:'Để đăng nhập Google, dùng Mời thành viên để người dùng đăng ký bằng Google. Thao tác này tạo tài khoản email/mật khẩu riêng, không tự liên kết Google qua email.',created:'Đã tạo tài khoản. Yêu cầu chủ tài khoản dùng Quên mật khẩu trên trang đăng nhập email. Quản trị viên không nhận mật khẩu.',disable:'Vô hiệu hóa đăng nhập',enable:'Bật đăng nhập',remove:'Xóa đăng nhập',retry:'Thử lại thay đổi đang chờ',pending:'Thay đổi tại thư mục đang chờ. Thử lại cùng thao tác để hoàn tất an toàn.',deleted:'Đã xóa đăng nhập. Kết quả học tập và lịch sử được giữ lại.',failure:'Chưa hoàn tất thay đổi. Tải lại trạng thái rồi thử lại thao tác đang chờ. Không thể vô hiệu hóa chính bạn hoặc Quản trị viên Central cuối cùng.',saved:'Đã cập nhật tài khoản.',confirm:'Xóa đăng nhập này?',description:'Chặn truy cập Academy, thu hồi phiên và chỉ xóa đăng nhập khách hàng đã liên kết. Giữ lại kết quả học tập, vai trò và lịch sử. Không xóa tài khoản Microsoft nội bộ. Nhập DELETE LOGIN để xác nhận.',confirmLabel:'Xác nhận',cancel:'Hủy',loading:'Đang xử lý…',active:'Đang bật',disabled:'Đã vô hiệu hóa',reload:'Tải lại trạng thái tài khoản'},
};
export function AccountControls({scope,actorId,userId,onChanged}:Props){
 const t=copy[useLocale()==='en'?'en':'vi'];
 const [state,setState]=useState<State|null>(null),[busy,setBusy]=useState(false),[status,setStatus]=useState(''),[confirm,setConfirm]=useState(false),[confirmation,setConfirmation]=useState('');
 const operation=useRef<string|null>(null),lock=useRef(false);
 const url=scopedUrl(`/api/v1/admin/accounts${userId?`/${encodeURIComponent(userId)}`:''}`,scope,{actorId});
 async function reload(){if(!userId)return;try{setState(await responseData<State>(await fetch(url,{cache:'no-store'})));}catch{setStatus(t.failure);}}
 useEffect(()=>{if(!userId)return;const controller=new AbortController();void fetch(url,{signal:controller.signal,cache:'no-store'}).then(responseData<State>).then(setState).catch(error=>{if(error.name!=='AbortError')setStatus(t.failure);});return()=>controller.abort();},[url,userId,t.failure]);
 async function mutate(body:Record<string,unknown>){
  if(lock.current)return;lock.current=true;setBusy(true);setStatus('');
  const id=state?.operation?.id??operation.current??crypto.randomUUID();operation.current=id;
  try{
   const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,operationId:id})});
   if(response.status>=400&&response.status<500)operation.current=null;
   await responseData(response);
   operation.current=null;setConfirm(false);setConfirmation('');setStatus(body.action==='create'||(!userId&&body.action==='retry')?t.created:t.saved);
   await reload();await onChanged();
  }catch{setStatus(t.failure);await reload();}finally{lock.current=false;setBusy(false);}
 }
 async function create(event:FormEvent<HTMLFormElement>){event.preventDefault();const data=new FormData(event.currentTarget);await mutate(operation.current?{action:'retry'}:{action:'create',email:data.get('email'),displayName:data.get('displayName')});}
 const pending=Boolean(state?.operation||operation.current);
 if(!userId)return <DataCard title={t.create} description={t.intro}><form onSubmit={create} className="grid gap-4 p-6 sm:max-w-xl"><CanvasTextInput label={t.name} name="displayName" required maxLength={160} disabled={busy||pending}/><CanvasTextInput label={t.email} name="email" type="email" required maxLength={254} disabled={busy||pending}/><Button type="submit" disabled={busy}>{busy?t.loading:pending?t.retry:t.create}</Button><RequestStatus>{status}</RequestStatus></form></DataCard>;
 return <DataCard title={t.title}><div className="grid gap-4 p-6">
  <p>{state?.status==='deleted'?t.deleted:state?.status==='disabled'?t.disabled:state?t.active:t.loading}</p>
  {state?.operation?<><p>{t.pending}</p><Button variant="outline" disabled={busy} onClick={()=>void mutate({action:'retry'})}>{t.retry}</Button></>:state&&state.status!=='deleted'?<div className="flex flex-wrap gap-3"><Button variant="outline" disabled={busy||actorId===userId} onClick={()=>void mutate({action:state.status==='active'?'disable':'enable'})}>{state.status==='active'?t.disable:t.enable}</Button><Button variant="outline" disabled={busy||actorId===userId} onClick={()=>setConfirm(true)}>{t.remove}</Button></div>:null}
  <Button variant="ghost" disabled={busy} onClick={()=>void reload()}>{t.reload}</Button><RequestStatus>{status}</RequestStatus>
  <ConfirmationDialog open={confirm} title={t.confirm} description={t.description} confirmLabel={busy?t.loading:t.remove} onCancel={()=>{if(!busy)setConfirm(false);}} onConfirm={()=>{if(confirmation==='DELETE LOGIN'&&!busy)void mutate({action:'delete',confirmation});}}><CanvasTextInput label={t.confirmLabel} value={confirmation} onChange={setConfirmation} autoComplete="off" disabled={busy}/></ConfirmationDialog>
 </div></DataCard>;
}
