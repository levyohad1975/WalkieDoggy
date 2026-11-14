import fs from 'node:fs';
import path from 'node:path';

const source=fs.readFileSync(path.resolve(__dirname,'../RemoteGpsPanel.tsx'),'utf8');

describe('RemoteGpsPanel target-device contract',()=>{
 it('polls commands only while the target app is foregrounded and checks the selected profile belongs to the walk',()=>{
  expect(source).toMatch(/AppState\.currentState!=='active'/);
  expect(source).toMatch(/pending\.walk_actual_walker_user_id!==currentUserId/);
  expect(source).toContain('pending.walk_status');
  expect(source).toContain('walk_not_started');
  expect(source).toMatch(/getMyRemoteGpsCommands\(\)/);
 });
 it('requires a tap (or already-granted permission with standing consent) and a real GPS fix before reporting tracking',()=>{
  const button=source.indexOf('const activateRemoteCommand=useCallback');
  const start=source.indexOf('useGpsStore.getState().startTracking(walk)',button);
  const check=source.indexOf("gps.permissionStatus==='granted'&&gps.pointCount>0",start);
  const ack=source.indexOf('acknowledgeRemoteGpsStart(cmd.command_id,tracking',check);
  expect(start).toBeGreaterThan(-1);
  expect(check).toBeGreaterThan(start);
  expect(ack).toBeGreaterThan(check);
  expect(source).toContain('waitForFirstGpsFix(walk.id)');
  expect(source).toContain('אישור והפעלת GPS במכשיר הזה');
  expect(source).not.toContain('startWalk(walk.id');
  // Owner request 2026-11-04: auto-start only with permission already granted
  // (or this device already tracking), once per command, behind consent.
  expect(source).toMatch(/!settings\?\.familyEnabled\|\|!settings\.consentEnabled\)return;/);
  expect(source).toMatch(/if\(alreadyTracking\|\|await isGeolocationAlreadyGranted\(\)\)\{\n\s*autoAttemptedRef\.current\.add\(pending\.command_id\);/);
 });
 it('shows a persistent accessible remote tracking message and a target stop control',()=>{
  expect(source).toContain('מעקב GPS הופעל מרחוק על ידי מנהל המשפחה');
  expect(source).toContain('עצירת מעקב GPS');
  expect(source).toContain('stopRemoteGpsTracking(command.command_id)');
 });
 it('only permits remote requests after family enablement and shows admin-reported command states',()=>{
  expect(source).toMatch(/familyRole==='admin'&&settings\?\.familyEnabled/);
  expect(source).toContain('getRemoteGpsWalkStatus(walk.id)');
  expect(source).toContain('ממתינה למכשיר היעד');
  expect(source).toContain('הבקשה נכשלה');
  expect(source).toContain('הבקשה פגה');
 });
 it('uses a persisted server GPS session as the admin-facing truth when the command is pending or failed',()=>{
  expect(source).toMatch(/gpsSession\?: WalkGpsSession \| null/);
  expect(source).toMatch(/const displayedWalkStatus=gpsSession\?\.pointCount\? 'tracking' : walkStatus/);
  expect(source).toContain('המעקב פעיל והמיקום נשמר בשרת');
 });
});
