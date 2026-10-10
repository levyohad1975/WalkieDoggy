import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AppState, Pressable, StyleSheet, View } from 'react-native';
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
 stopRemoteGpsTracking,getRemoteGpsWalkStatus,heartbeatRemoteGpsTracking,type RemoteGpsCommand,type RemoteGpsTarget,
} from '../lib/remoteGps';

interface Props { walk?: Walk; currentUserId: string; familyRole: string | null; ready: boolean; mode?: 'home' | 'settings' }
export function RemoteGpsPanel({walk,currentUserId,familyRole,ready,mode='home'}:Props) {
 const { users }=useFamilyStore();
 const [settings,setSettings]=useState<{familyEnabled:boolean;consentEnabled:boolean;isAdmin:boolean}|null>(null);
 const [targets,setTargets]=useState<RemoteGpsTarget[]>([]);
 const [selecting,setSelecting]=useState(false);
 const [command,setCommand]=useState<RemoteGpsCommand|null>(null);
 const [walkStatus,setWalkStatus]=useState<string|null>(null);
 const [busy,setBusy]=useState(false);
 const processingRef=useRef(false);
 const startWalk=useScheduleStore(s=>s.startWalk);
 const trackingWalkId=useGpsStore(s=>s.trackingWalkId);
 const permissionStatus=useGpsStore(s=>s.permissionStatus);
 const waitForFirstGpsFix=useCallback((walkId:string)=>new Promise<boolean>(resolve=>{
  const initial=useGpsStore.getState();if(initial.trackingWalkId===walkId&&initial.permissionStatus==='granted'&&initial.pointCount>0){resolve(true);return;}
  if(initial.trackingWalkId!==walkId||initial.permissionStatus==='denied'||initial.permissionStatus==='unavailable'){resolve(false);return;}
  let settled=false;let unsubscribe=()=>{};const finish=(value:boolean)=>{if(settled)return;settled=true;clearTimeout(timer);unsubscribe();resolve(value);};
  const timer=setTimeout(()=>finish(false),15_000);
  unsubscribe=useGpsStore.subscribe(state=>{if(state.trackingWalkId!==walkId||state.permissionStatus==='denied'||state.permissionStatus==='unavailable')finish(false);else if(state.permissionStatus==='granted'&&state.pointCount>0)finish(true);});
 }),[]);
 const refresh=useCallback(async()=>{if(!isSupabaseConfigured)return; try{const [s,cs]=await Promise.all([getRemoteGpsSettings(),getMyRemoteGpsCommands()]);setSettings(s);setCommand(cs.find(c=>c.status==='tracking')??null);if(walk&&familyRole==='admin'){const statuses=await getRemoteGpsWalkStatus(walk.id);setWalkStatus(statuses[0]?.status??null);}}catch{/* offline/error remain opt-in closed */}},[walk?.id,familyRole]);
 useEffect(()=>{void refresh(); const timer=setInterval(()=>{if(AppState.currentState==='active')void refresh();},6000);const sub=AppState.addEventListener('change',state=>{if(state==='active')void refresh();});return()=>{clearInterval(timer);sub.remove();};},[refresh]);
 const processPending=useCallback(async()=>{
  if(AppState.currentState!=='active'||!ready||!isSupabaseConfigured||!settings?.familyEnabled||!settings.consentEnabled)return;
  if(processingRef.current)return;processingRef.current=true;
  try{const commands=await getMyRemoteGpsCommands();const activeWalk=useGpsStore.getState().trackingWalkId;
   for(const tracked of commands.filter(c=>c.status==='tracking')){if(activeWalk===tracked.walk_id)await heartbeatRemoteGpsTracking(tracked.command_id);else await stopRemoteGpsTracking(tracked.command_id);}
   if(activeWalk&&!commands.some(c=>c.status==='tracking'&&c.walk_id===activeWalk)){const oldWalk=useScheduleStore.getState().walks.find(w=>w.id===activeWalk);if(oldWalk)await useGpsStore.getState().stopTracking(oldWalk,currentUserId);}
   const pending=commands.find(c=>c.status==='pending');if(!pending)return;
   const walk=useScheduleStore.getState().walks.find(w=>w.id===pending.walk_id);if(!walk||walk.familyId!==useFamilyStore.getState().family?.id||walk.responsibleUserId!==currentUserId){await acknowledgeRemoteGpsStart(pending.command_id,false,'walk_unavailable');return;}
   let started=walk.status==='in_progress';if(!started)started=await useScheduleStore.getState().startWalk(walk.id,{startGps:false,remoteActivation:true});
   if(!started){await acknowledgeRemoteGpsStart(pending.command_id,false,'walk_unavailable');return;}
   await useGpsStore.getState().startTracking(walk);
   const fixReceived=await waitForFirstGpsFix(walk.id);const gps=useGpsStore.getState();const tracking=fixReceived&&gps.trackingWalkId===walk.id&&gps.permissionStatus==='granted'&&gps.pointCount>0;
   const failureReason=tracking?undefined:(gps.permissionStatus==='granted'?'no_gps_fix':gps.permissionStatus??'location_unavailable');
   await acknowledgeRemoteGpsStart(pending.command_id,tracking,failureReason);
   if(tracking)setCommand({...pending,status:'tracking'});else await useGpsStore.getState().stopTracking(walk,currentUserId);
  }catch(e){console.warn('Remote GPS activation failed',e);}finally{processingRef.current=false;}
 },[settings,currentUserId,ready,waitForFirstGpsFix]);
 useEffect(()=>{void processPending();const timer=setInterval(()=>void processPending(),6000);return()=>clearInterval(timer);},[processPending]);
 const toggleConsent=async()=>{if(busy||!settings)return;setBusy(true);try{await setRemoteGpsConsent(!settings.consentEnabled);await refresh();}catch{Alert.alert('לא ניתן לעדכן הסכמה','בדקו חיבור לאינטרנט ונסו שוב.');}finally{setBusy(false);}};
 const toggleFamily=async()=>{if(busy||!settings)return;setBusy(true);try{await setFamilyRemoteGpsEnabled(!settings.familyEnabled);await refresh();}catch{Alert.alert('לא ניתן לעדכן הגדרת משפחה','נדרשת הרשאת מנהל המשפחה.');}finally{setBusy(false);}};
 const chooseRemote=async()=>{if(!walk||busy)return;setBusy(true);try{const eligible=await listRemoteGpsTargets(walk.id);setTargets(eligible);if(!eligible.length){Alert.alert('אין מכשיר מורשה','המשפחה צריכה לאפשר מעקב, ובן המשפחה צריך להפעיל הסכמה במכשיר שלו.');return;}setSelecting(true);}catch{Alert.alert('לא ניתן לשלוח בקשה','בדקו שהמשפחה ומכשיר היעד מחוברים והסכמה פעילה.');}finally{setBusy(false);}};
 const selectTarget=async(target:RemoteGpsTarget)=>{if(!walk)return;setBusy(true);setSelecting(false);try{const id=await requestRemoteGpsStart(walk.id,target.target_auth_user_id);try{await sendRemoteGpsNotification(id);}catch{/* command remains pending; target foreground polling is authoritative */}Alert.alert('הבקשה נשלחה',`הבקשה נשלחה אל ${target.display_name}. המעקב ייחשב פעיל רק לאחר אישור GPS ממכשיר היעד.`);}catch{Alert.alert('הבקשה לא נשלחה','השרת דחה את הבקשה או שההסכמה אינה פעילה.');}finally{setBusy(false);}};
 const stop=async()=>{if(!command||busy)return;setBusy(true);try{const walk=useScheduleStore.getState().walks.find(w=>w.id===command.walk_id);if(walk)await useGpsStore.getState().stopTracking(walk,currentUserId);await stopRemoteGpsTracking(command.command_id);setCommand(null);}catch{Alert.alert('לא ניתן לעצור את המעקב','נסו שוב כשהחיבור יחזור.');}finally{setBusy(false);}};
 if(!isSupabaseConfigured)return null;
 const visible=Boolean(settings&&(familyRole==='admin'||settings.consentEnabled||command||walk?.status==='pending'||walk?.status==='in_progress'));
 if(!visible && mode==='home')return null;
  if(mode==='home' && !selecting && !walkStatus && !(command && trackingWalkId===command.walk_id) && !(familyRole==='admin' && settings?.familyEnabled && walk && (walk.status==='pending'||walk.status==='in_progress')))return null;
 const targetName=targets.find(t=>t.target_user_id===currentUserId)?.display_name??users.find(u=>u.id===currentUserId)?.name??'בן משפחה';
 return <View style={styles.panel}>
  {mode==='settings'&&settings?.isAdmin?<Pressable accessibilityRole="switch" accessibilityState={{checked:settings.familyEnabled}} onPress={()=>void toggleFamily()} style={styles.row}><RtlText style={styles.text}>הפעלת GPS מרחוק למשפחה</RtlText><RtlText style={styles.state}>{settings.familyEnabled?'פעיל':'כבוי'}</RtlText></Pressable>:null}
  {mode==='settings'?<Pressable accessibilityRole="switch" accessibilityState={{checked:settings?.consentEnabled??false}} onPress={()=>void toggleConsent()} style={styles.row}><RtlText style={styles.text}>אני מסכים/ה להפעלת GPS מרחוק</RtlText><RtlText style={styles.state}>{settings?.consentEnabled?'פעיל':'כבוי'}</RtlText></Pressable>:null}
  {mode==='home'&&familyRole==='admin'&&settings?.familyEnabled&&walk&&(walk.status==='pending'||walk.status==='in_progress')?<Pressable accessibilityRole="button" disabled={busy} onPress={()=>void chooseRemote()} style={styles.action}><RtlText style={styles.actionText}>התחל טיול מרחוק</RtlText></Pressable>:null}
  {mode==='home'&&selecting?targets.map(t=><Pressable key={t.target_auth_user_id} accessibilityRole="button" accessibilityLabel={`${t.display_name}, ${t.device_label}`} onPress={()=>void selectTarget(t)} style={styles.target}><RtlText style={styles.text}>{t.display_name} · {t.device_label}</RtlText></Pressable>):null}
  {mode==='home'&&familyRole==='admin'&&walkStatus?<RtlText accessibilityLiveRegion="polite" style={styles.status}>מצב בקשת GPS: {({pending:'ממתינה למכשיר היעד',tracking:'המעקב פעיל במכשיר היעד',failed:'הבקשה נכשלה',expired:'הבקשה פגה',stopped:'המעקב נעצר'} as Record<string,string>)[walkStatus]??walkStatus}</RtlText>:null}
  {mode==='home'&&command&&trackingWalkId===command.walk_id?<View accessibilityLiveRegion="polite" style={styles.active}><RtlText style={styles.activeText}>מעקב GPS הופעל מרחוק על ידי מנהל המשפחה{targetName?` · ${targetName}`:''}</RtlText><RtlText accessibilityRole="text" style={styles.status}>מעקב GPS פעיל במכשיר הזה</RtlText><Pressable accessibilityRole="button" onPress={()=>void stop()} style={styles.stop}><RtlText style={styles.stopText}>עצירת מעקב GPS</RtlText></Pressable></View>:null}
  {mode==='home'&&command&&trackingWalkId!==command.walk_id?<RtlText style={styles.status}>בקשת מעקב: ממתינה לאישור מכשיר היעד</RtlText>:null}
  {mode==='home'&&permissionStatus==='denied'?<RtlText style={styles.status}>הפעלת GPS נכשלה: הרשאת מיקום נדחתה</RtlText>:null}
 </View>;
}
const styles=StyleSheet.create({panel:{backgroundColor:colors.surface,borderColor:colors.border,borderWidth:1,borderRadius:radii.lg,padding:spacing.md,marginVertical:spacing.sm,gap:spacing.sm},row:{minHeight:44,flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:spacing.md},text:{color:colors.textPrimary,fontSize:14,fontWeight:'600'},state:{color:colors.primary,fontWeight:'700'},action:{minHeight:48,alignItems:'center',justifyContent:'center',backgroundColor:colors.primary,borderRadius:radii.md,paddingHorizontal:spacing.md},actionText:{color:colors.textInverse,fontWeight:'700'},target:{minHeight:44,padding:spacing.sm,borderTopWidth:1,borderTopColor:colors.border},active:{padding:spacing.md,backgroundColor:'#E8F5EC',borderRadius:radii.md,gap:spacing.xs},activeText:{color:'#14532D',fontSize:14,fontWeight:'700'},status:{color:colors.textSecondary,fontSize:13},stop:{alignSelf:'flex-start',paddingVertical:spacing.sm,paddingHorizontal:spacing.md,backgroundColor:'#A61B1B',borderRadius:radii.md},stopText:{color:'#fff',fontWeight:'700'}});
