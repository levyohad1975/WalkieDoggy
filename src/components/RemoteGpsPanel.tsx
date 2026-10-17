import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AppState, Platform, Pressable, StyleSheet, View } from 'react-native';
import { RtlText } from './RtlText';
import { useScheduleStore } from '../store/scheduleStore';
import { useGpsStore } from '../store/gpsStore';
import { useFamilyStore } from '../store/familyStore';
import { isSupabaseConfigured } from '../lib/supabase';
import { colors } from '../theme/colors';
import { radii, spacing } from '../theme/tokens';
import type { Walk } from '../types';
import {
 acknowledgeRemoteGpsStart,getMyRemoteGpsCommands,getRemoteGpsSettings,listRemoteGpsTargets,
 requestRemoteGpsStart,sendRemoteGpsNotification,setFamilyRemoteGpsEnabled,setRemoteGpsConsent,
 stopRemoteGpsTracking,getRemoteGpsWalkStatus,heartbeatRemoteGpsTracking,getRemoteGpsCommandOutcome,type RemoteGpsCommand,type RemoteGpsTarget,
} from '../lib/remoteGps';
import { describeRemoteGpsOutcome, isAuthorizedRemoteGpsTermination } from '../logic/remoteGpsTermination';

/** React Native Alert.alert is a no-op in react-native-web (iPhone Safari / Android browser). */
function showGpsMessage(title:string,message:string){
 if(Platform.OS==='web' && typeof window!=='undefined'){window.alert(`${title}\n\n${message}`);return;}
 Alert.alert(title,message);
}

interface Props { walk?: Walk; currentUserId: string; familyRole: string | null; ready: boolean; mode?: 'home' | 'settings' }
export function RemoteGpsPanel({walk,currentUserId,familyRole,ready,mode='home'}:Props) {
 const { users }=useFamilyStore();
 const [settings,setSettings]=useState<{familyEnabled:boolean;consentEnabled:boolean;isAdmin:boolean}|null>(null);
 const [targets,setTargets]=useState<RemoteGpsTarget[]>([]);
 const [selecting,setSelecting]=useState(false);
 const [command,setCommand]=useState<RemoteGpsCommand|null>(null);
 const [walkStatus,setWalkStatus]=useState<string|null>(null);
 const [busy,setBusy]=useState(false);
 const [feedback,setFeedback]=useState<string|null>(null);
 const processingRef=useRef(false);
 const trackingWalkId=useGpsStore(s=>s.trackingWalkId);
 const permissionStatus=useGpsStore(s=>s.permissionStatus);
 const waitForFirstGpsFix=useCallback((walkId:string)=>new Promise<boolean>(resolve=>{
  const initial=useGpsStore.getState();if(initial.trackingWalkId===walkId&&initial.permissionStatus==='granted'&&initial.pointCount>0){resolve(true);return;}
  if(initial.trackingWalkId!==walkId||initial.permissionStatus==='denied'||initial.permissionStatus==='unavailable'){resolve(false);return;}
  let settled=false;let unsubscribe=()=>{};const finish=(value:boolean)=>{if(settled)return;settled=true;clearTimeout(timer);unsubscribe();resolve(value);};
  const timer=setTimeout(()=>finish(false),15_000);
  unsubscribe=useGpsStore.subscribe(state=>{if(state.trackingWalkId!==walkId||state.permissionStatus==='denied'||state.permissionStatus==='unavailable')finish(false);else if(state.permissionStatus==='granted'&&state.pointCount>0)finish(true);});
 }),[]);
 // P0 real-iPhone report (2026-10-15, 17:32): an admin who is ALSO the
 // walk's actual walker on this same device was offered "בקש אישור GPS
 // ממכשיר המטייל/ת" (request remote consent from the walker's device) —
 // nonsensical when that device IS this device. Identity is the lifecycle
 // actor field, never the display name: actualWalkerUserId falls back to
 // responsibleUserId exactly like every other walker-identity check in
 // this app (HomeScreen's onEndWalk gate, gpsNotTrackedHere).
 const isActualWalkerHere=walk?(walk.actualWalkerUserId??walk.responsibleUserId)===currentUserId:false;
 const refresh=useCallback(async()=>{if(!isSupabaseConfigured)return; try{const [s,cs]=await Promise.all([getRemoteGpsSettings(),getMyRemoteGpsCommands()]);setSettings(s);setCommand(cs.find(c=>c.status==='tracking')??cs.find(c=>c.status==='pending')??null);if(walk&&familyRole==='admin'){const statuses=await getRemoteGpsWalkStatus(walk.id);setWalkStatus(statuses[0]?.status??null);}}catch{/* offline/error remain opt-in closed */}},[walk?.id,familyRole]);
 useEffect(()=>{void refresh(); const timer=setInterval(()=>{if(AppState.currentState==='active')void refresh();},6000);const sub=AppState.addEventListener('change',state=>{if(state==='active')void refresh();});return()=>{clearInterval(timer);sub.remove();};},[refresh]);
 const processPending=useCallback(async()=>{
  if(AppState.currentState!=='active'||!ready||!isSupabaseConfigured||!settings?.familyEnabled||!settings.consentEnabled)return;
  if(processingRef.current)return;processingRef.current=true;
  try{const commands=await getMyRemoteGpsCommands();const activeWalk=useGpsStore.getState().trackingWalkId;
   for(const tracked of commands.filter(c=>c.status==='tracking')){if(activeWalk===tracked.walk_id)await heartbeatRemoteGpsTracking(tracked.command_id);else await stopRemoteGpsTracking(tracked.command_id);}
   // Only a session a Remote GPS command started is ever affected here — the
   // walker's own Start / "הפעל GPS" session never has a command (P0 fix
   // e717b60). And a command that merely vanished from the active list is not
   // proof of an authorized stop: the admin-side status check fails a
   // command as 'target_inactive' after 30 s, which ended a live iPhone
   // session ~34 s after its first fix while the walk stayed active (P0
   // 2026-10-15). Read the command's own final state and end the session only
   // for an authorized termination; otherwise keep it running as local.
   const gpsNow=useGpsStore.getState();
   if(activeWalk&&gpsNow.trackingSource==='remote'&&!commands.some(c=>c.status==='tracking'&&c.walk_id===activeWalk)){
    const commandId=gpsNow.remoteGpsCommandId;
    let outcome:{status:string;failure_reason:string|null}|null=null;
    try{outcome=commandId?await getRemoteGpsCommandOutcome(commandId):null;}catch(e){console.warn('Remote GPS command outcome unavailable; keeping the walker\'s GPS session',e);}
    const oldWalk=useScheduleStore.getState().walks.find(w=>w.id===activeWalk);
    if(isAuthorizedRemoteGpsTermination(outcome)&&oldWalk)await useGpsStore.getState().stopTracking(oldWalk,currentUserId,'remote_command_terminated',describeRemoteGpsOutcome(outcome));
    else useGpsStore.getState().detachRemoteTracking(activeWalk,describeRemoteGpsOutcome(outcome));
   }
   const pending=commands.find(c=>c.status==='pending');if(!pending)return;
   const walk=useScheduleStore.getState().walks.find(w=>w.id===pending.walk_id);if(!walk||walk.familyId!==useFamilyStore.getState().family?.id||(walk.actualWalkerUserId??walk.responsibleUserId)!==currentUserId){await acknowledgeRemoteGpsStart(pending.command_id,false,'walk_unavailable');return;}
   // Remote GPS is consent to request a device location session, never an
   // implicit walk start. The actual walker must first start the walk and
   // then explicitly tap the activation button below (required by Safari's
   // user-gesture permission model).
   if(walk.status!=='in_progress'){await acknowledgeRemoteGpsStart(pending.command_id,false,'walk_not_started');return;}
   setCommand(pending);setFeedback('בקשת GPS ממתינה לאישור שלך במכשיר הזה.');
   return;
  }catch(e){console.warn('Remote GPS command check failed',e);}finally{processingRef.current=false;}
 },[settings,currentUserId,ready]);
 const activatePendingGps=useCallback(async()=>{
  if(!command||command.status!=='pending'||busy)return;
  const walk=useScheduleStore.getState().walks.find(w=>w.id===command.walk_id);
  if(!walk||walk.status!=='in_progress'||walk.familyId!==useFamilyStore.getState().family?.id||(walk.actualWalkerUserId??walk.responsibleUserId)!==currentUserId){setFeedback('הטיול אינו פעיל או שאינך המטייל/ת בפועל.');return;}
  setBusy(true);setFeedback('מבקש הרשאת מיקום במכשיר הזה…');
  try{
   // This call is deliberately made synchronously from the button handler
   // before its first await so iPhone Safari can associate it with the tap.
   const starting=useGpsStore.getState().startTracking(walk);
   await starting;
   const currentWalk=useScheduleStore.getState().walks.find(w=>w.id===walk.id)??walk;
   const lease=await useGpsStore.getState().attachGpsOwnership(currentWalk);
   const fixReceived=lease&&await waitForFirstGpsFix(walk.id);const gps=useGpsStore.getState();const tracking=Boolean(fixReceived&&gps.trackingWalkId===walk.id&&gps.permissionStatus==='granted'&&gps.pointCount>0);
   const failureReason=tracking?undefined:(gps.permissionStatus==='granted'?'no_gps_fix':gps.permissionStatus??'location_unavailable');
   await acknowledgeRemoteGpsStart(command.command_id,tracking,failureReason);
   if(tracking){useGpsStore.getState().markRemoteTracking(walk.id,command.command_id);setCommand({...command,status:'tracking'});setFeedback('GPS פעיל במכשיר הזה.');}
   else{useGpsStore.getState().cancelTracking(walk.id,'remote_activation_failed');setFeedback(`GPS לא הופעל: ${failureReason??'מיקום לא זמין'}. אפשר לנסות שוב מהטיול הפעיל.`);}
  }catch(e){setFeedback('לא ניתן להפעיל GPS. בדקו הרשאת מיקום וחיבור ונסו שוב.');showGpsMessage('הפעלת GPS נכשלה','הטיול נשאר פעיל. בדקו שהרשאת המיקום מופעלת ונסו שוב.');}
  finally{setBusy(false);}
 },[command,busy,currentUserId,waitForFirstGpsFix]);
 useEffect(()=>{void processPending();const timer=setInterval(()=>void processPending(),6000);return()=>clearInterval(timer);},[processPending]);
 const toggleConsent=async()=>{if(busy||!settings)return;setBusy(true);try{await setRemoteGpsConsent(!settings.consentEnabled);await refresh();}catch{showGpsMessage('לא ניתן לעדכן הסכמה','בדקו חיבור לאינטרנט ונסו שוב.');}finally{setBusy(false);}};
 const toggleFamily=async()=>{if(busy||!settings)return;setBusy(true);try{await setFamilyRemoteGpsEnabled(!settings.familyEnabled);await refresh();}catch{showGpsMessage('לא ניתן לעדכן הגדרת משפחה','נדרשת הרשאת מנהל המשפחה.');}finally{setBusy(false);}};
 const chooseRemote=async()=>{if(!walk||walk.status!=='in_progress'||busy)return;setBusy(true);setFeedback('בודק מכשירים זמינים להפעלה מרחוק…');try{const eligible=await listRemoteGpsTargets(walk.id);setTargets(eligible);if(!eligible.length){setFeedback('לא נמצא מכשיר מורשה לטיול זה. בדקו הסכמה והרשאת מיקום במכשיר של בן המשפחה.');showGpsMessage('אין מכשיר מורשה','המשפחה צריכה לאפשר מעקב, ובן המשפחה צריך להפעיל הסכמה במכשיר שלו.');return;}setSelecting(true);setFeedback('בחרו את המכשיר של בן המשפחה להפעלת המעקב.');}catch{setFeedback('בדיקת המכשירים נכשלה. בדקו חיבור והרשאות.');showGpsMessage('לא ניתן לשלוח בקשה','בדקו שהמשפחה ומכשיר היעד מחוברים והסכמה פעילה.');}finally{setBusy(false);}};
 const selectTarget=async(target:RemoteGpsTarget)=>{if(!walk)return;setBusy(true);setSelecting(false);setFeedback('שולח בקשת GPS למכשיר היעד…');try{const id=await requestRemoteGpsStart(walk.id,target.target_auth_user_id);let pushDelivered=false;try{await sendRemoteGpsNotification(id);pushDelivered=true;}catch(error){console.warn('Remote GPS push failed; command remains pending',error);}if(pushDelivered){setFeedback('בקשת GPS נוצרה והודעת Push נשלחה; ממתינים לאישור במכשיר היעד.');showGpsMessage('הבקשה נשלחה',`הודעת Push נשלחה אל ${target.display_name}. המעקב ייחשב פעיל רק לאחר אישור GPS ממכשיר היעד.`);}else{setFeedback('בקשת GPS נוצרה, אך שליחת הודעת Push נכשלה. בקשו מבן המשפחה לפתוח את האפליקציה ולאשר GPS.');showGpsMessage('הבקשה נוצרה ללא הודעת Push',`לא הצלחנו לשלוח התראה אל ${target.display_name}. הבקשה ממתינה; יש לפתוח את האפליקציה במכשיר היעד.`);}}catch{setFeedback('השרת דחה את הבקשה. בדקו הסכמה והרשאות.');showGpsMessage('הבקשה לא נשלחה','השרת דחה את הבקשה או שההסכמה אינה פעילה.');}finally{setBusy(false);}};
 const stop=async()=>{if(!command||busy)return;setBusy(true);try{const walk=useScheduleStore.getState().walks.find(w=>w.id===command.walk_id);if(walk)await useGpsStore.getState().stopTracking(walk,currentUserId,'remote_gps_stopped_by_user');await stopRemoteGpsTracking(command.command_id);setCommand(null);}catch{showGpsMessage('לא ניתן לעצור את המעקב','נסו שוב כשהחיבור יחזור.');}finally{setBusy(false);}};
 if(!isSupabaseConfigured)return null;
 const visible=Boolean(settings&&(familyRole==='admin'||settings.consentEnabled||command||walk?.status==='pending'||walk?.status==='in_progress'));
 if(!visible && mode==='home')return null;
  if(mode==='home' && !selecting && !walkStatus && !(command && trackingWalkId===command.walk_id) && !(familyRole==='admin' && settings?.familyEnabled && walk && (walk.status==='pending'||walk.status==='in_progress')))return null;
 const targetName=targets.find(t=>t.target_user_id===currentUserId)?.display_name??users.find(u=>u.id===currentUserId)?.name??'בן משפחה';
 return <View style={mode==='home'?styles.compactPanel:styles.panel}>
  {mode==='settings'&&settings?.isAdmin?<Pressable accessibilityRole="switch" accessibilityState={{checked:settings.familyEnabled}} onPress={()=>void toggleFamily()} style={styles.row}><RtlText style={styles.text}>הפעלת GPS מרחוק למשפחה</RtlText><RtlText style={styles.state}>{settings.familyEnabled?'פעיל':'כבוי'}</RtlText></Pressable>:null}
  {mode==='settings'?<Pressable accessibilityRole="switch" accessibilityState={{checked:settings?.consentEnabled??false}} onPress={()=>void toggleConsent()} style={styles.row}><RtlText style={styles.text}>אני מסכים/ה להפעלת GPS מרחוק</RtlText><RtlText style={styles.state}>{settings?.consentEnabled?'פעיל':'כבוי'}</RtlText></Pressable>:null}
  {mode==='home'&&!isActualWalkerHere&&familyRole==='admin'&&settings?.familyEnabled&&walk?.status==='in_progress'?<Pressable accessibilityRole="button" disabled={busy} onPress={()=>void chooseRemote()} style={styles.compactAction}><RtlText style={styles.compactActionText}>📍 בקש אישור GPS ממכשיר המטייל/ת</RtlText></Pressable>:null}
  {mode==='home'&&feedback?<RtlText accessibilityLiveRegion="polite" style={styles.status}>{feedback}</RtlText>:null}
  {mode==='home'&&selecting?targets.map(t=><Pressable key={t.target_auth_user_id} accessibilityRole="button" accessibilityLabel={`${t.display_name}, ${t.device_label}`} onPress={()=>void selectTarget(t)} style={styles.target}><RtlText style={styles.text}>{t.display_name} · {t.device_label}</RtlText></Pressable>):null}
  {mode==='home'&&familyRole==='admin'&&walkStatus?<RtlText accessibilityLiveRegion="polite" style={styles.status}>מצב בקשת GPS: {({pending:'ממתינה למכשיר היעד',tracking:'המעקב פעיל במכשיר היעד',failed:'הבקשה נכשלה',expired:'הבקשה פגה',stopped:'המעקב נעצר'} as Record<string,string>)[walkStatus]??walkStatus}</RtlText>:null}
  {mode==='home'&&command&&trackingWalkId===command.walk_id?<View accessibilityLiveRegion="polite" style={styles.active}><RtlText style={styles.activeText}>מעקב GPS הופעל מרחוק על ידי מנהל המשפחה{targetName?` · ${targetName}`:''}</RtlText><RtlText accessibilityRole="text" style={styles.status}>מעקב GPS פעיל במכשיר הזה</RtlText><Pressable accessibilityRole="button" onPress={()=>void stop()} style={styles.stop}><RtlText style={styles.stopText}>עצירת מעקב GPS</RtlText></Pressable></View>:null}
  {mode==='home'&&command&&trackingWalkId!==command.walk_id?<View><RtlText style={styles.status}>בקשת GPS ממנהל המשפחה ממתינה לאישור שלך. הטיול נשאר פעיל ללא GPS עד שתאשר/י.</RtlText>{command.status==='pending'&&settings?.familyEnabled&&settings.consentEnabled?<Pressable accessibilityRole="button" disabled={busy} onPress={()=>void activatePendingGps()} style={styles.compactAction}><RtlText style={styles.compactActionText}>אישור והפעלת GPS במכשיר הזה</RtlText></Pressable>:<RtlText style={styles.status}>יש לאשר GPS בהגדרות המשפחה לפני ההפעלה.</RtlText>}</View>:null}
  {mode==='home'&&permissionStatus==='denied'?<RtlText style={styles.status}>הפעלת GPS נכשלה: הרשאת מיקום נדחתה</RtlText>:null}
 </View>;
}
const styles=StyleSheet.create({compactPanel:{paddingHorizontal:0,paddingVertical:0,gap:spacing.xs},compactAction:{minHeight:32,alignSelf:'flex-start',justifyContent:'center',paddingHorizontal:spacing.sm,borderRadius:radii.md,backgroundColor:'#E7F5F4'},compactActionText:{color:colors.primary,fontWeight:'700',fontSize:13},panel:{backgroundColor:colors.surface,borderColor:colors.border,borderWidth:1,borderRadius:radii.lg,padding:spacing.md,marginVertical:spacing.sm,gap:spacing.sm},row:{minHeight:44,flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:spacing.md},text:{color:colors.textPrimary,fontSize:14,fontWeight:'600'},state:{color:colors.primary,fontWeight:'700'},action:{minHeight:48,alignItems:'center',justifyContent:'center',backgroundColor:colors.primary,borderRadius:radii.md,paddingHorizontal:spacing.md},actionText:{color:colors.textInverse,fontWeight:'700'},target:{minHeight:44,padding:spacing.sm,borderTopWidth:1,borderTopColor:colors.border},active:{padding:spacing.md,backgroundColor:'#E8F5EC',borderRadius:radii.md,gap:spacing.xs},activeText:{color:'#14532D',fontSize:14,fontWeight:'700'},status:{color:colors.textSecondary,fontSize:13},stop:{alignSelf:'flex-start',paddingVertical:spacing.sm,paddingHorizontal:spacing.md,backgroundColor:'#A61B1B',borderRadius:radii.md},stopText:{color:'#fff',fontWeight:'700'}});
