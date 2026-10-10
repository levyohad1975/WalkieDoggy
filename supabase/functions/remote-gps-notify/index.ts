import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const cors = { 'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS' };
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'content-type':'application/json'}});
const vapidPublic=Deno.env.get('VAPID_PUBLIC_KEY')??'';const vapidPrivate=Deno.env.get('VAPID_PRIVATE_KEY')??'';
if(vapidPublic&&vapidPrivate)webpush.setVapidDetails(Deno.env.get('VAPID_SUBJECT')??'https://walkielink.co.il',vapidPublic,vapidPrivate);
Deno.serve(async(req:Request)=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
 if(req.method!=='POST')return json({ok:false,error:'method not allowed'},405);
 const authorization=req.headers.get('Authorization');if(!authorization)return json({ok:false,error:'unauthorized'},401);
 try{
  const url=Deno.env.get('SUPABASE_URL')!;const anon=Deno.env.get('SUPABASE_ANON_KEY')!;const service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const caller=createClient(url,anon,{global:{headers:{Authorization:authorization}}});const {data:auth,error:authError}=await caller.auth.getUser();
  if(authError||!auth.user)return json({ok:false,error:'unauthorized'},401);
  const payload=await req.json().catch(()=>({}));const commandId=payload?.commandId;
  if(typeof commandId!=='string'||!/^[0-9a-f-]{36}$/i.test(commandId))return json({ok:false,error:'invalid command'},400);
  const {data:context,error:contextError}=await caller.rpc('remote_gps_device_notification_context',{p_command_id:commandId});
  if(contextError)throw contextError;if(!context?.length)return json({ok:false,error:'command unavailable'},403);
  const targetUserId=context[0].target_user_id;const targetAuthUserId=context[0].target_auth_user_id;const admin=createClient(url,service);
  const [{data:expo,error:expoError},{data:web,error:webError}]=await Promise.all([
   admin.from('push_tokens').select('token').eq('user_id',targetUserId).eq('auth_user_id',targetAuthUserId).eq('is_active',true),
   admin.from('web_push_subscriptions').select('endpoint,p256dh,auth').eq('user_id',targetUserId).eq('auth_user_id',targetAuthUserId).eq('is_active',true),
  ]);if(expoError)throw expoError;if(webError)throw webError;
  const message={to:'',title:'Walkie Doggy',body:'מנהל המשפחה ביקש להתחיל מעקב טיול. פתחו את Walkie Doggy כדי לעבד את הבקשה.',sound:'default',priority:'high',data:{type:'remote_gps_start',commandId}};
  const expoTokens=[...new Set((expo??[]).map(x=>x.token))];let expoSent=0;let webSent=0;
  if(expoTokens.length){const response=await fetch('https://exp.host/--/api/v2/push/send',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(expoTokens.map(to=>({...message,to})))});if(response.ok)expoSent=expoTokens.length;}
  if(vapidPublic&&vapidPrivate){for(const sub of web??[]){try{await webpush.sendNotification({endpoint:sub.endpoint,keys:{p256dh:sub.p256dh,auth:sub.auth}},JSON.stringify({title:message.title,body:message.body,data:message.data}));webSent++;}catch{/* per-device delivery can fail while other destinations succeed */}}}
  return json({ok:true,expoSent,webSent});
 }catch(error){console.error('remote-gps-notify failed',error);return json({ok:false,error:'notification delivery failed'},500);}
});
