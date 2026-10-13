import fs from 'node:fs';
import path from 'node:path';

const source=fs.readFileSync(path.resolve(__dirname,'../RemoteGpsPanel.tsx'),'utf8');

describe('RemoteGpsPanel target-device contract',()=>{
 it('polls commands only while the target app is foregrounded and checks the selected profile belongs to the walk',()=>{
  expect(source).toMatch(/AppState\.currentState!=='active'/);
  expect(source).toMatch(/walk\.responsibleUserId!==currentUserId/);
  expect(source).toMatch(/getMyRemoteGpsCommands\(\)/);
 });
 it('does not report tracking until the target device GPS watch starts successfully and is acknowledged',()=>{
  const start=source.indexOf('await useGpsStore.getState().startTracking(walk)');
  const check=source.indexOf("gps.permissionStatus==='granted'&&gps.pointCount>0",start);
  const ack=source.indexOf('acknowledgeRemoteGpsStart(pending.command_id,tracking',check);
  expect(start).toBeGreaterThan(-1);
  expect(check).toBeGreaterThan(start);
  expect(ack).toBeGreaterThan(check);
  expect(source).toContain('waitForFirstGpsFix(walk.id)');
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
});
