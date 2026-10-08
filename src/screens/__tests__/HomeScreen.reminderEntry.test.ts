import fs from 'fs';
import path from 'path';

describe('Home reminder-notification integration', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'HomeScreen.tsx'), 'utf8');

  it('navigates a valid reminder-open event to Home before storing its presentation state', () => {
    const navigate = source.indexOf("navigation.navigate('Home')");
    const storeEvent = source.indexOf('setReminderPrompt(event)');
    expect(navigate).toBeGreaterThan(-1);
    expect(storeEvent).toBeGreaterThan(navigate);
  });

  it('only presents the prompt for the current pending walk, using dynamic gender-aware dog copy', () => {
    expect(source).toContain("if (!walk || walk.status !== 'pending') return null;");
    expect(source).toContain("renderMessageTemplate('{responsibleName}, הגיע הזמן לטייל עם {dogNoun} 🐾'");
    expect(source).toContain('dogName: walkDog.name');
    expect(source).toContain('dogSex: walkDog.sex');
  });

  it('resolves the walk\'s OWN dog by walk.dogId (PRD §11 multi-dog) — never assumes the reminder is for whichever dog is currently selected in the UI', () => {
    expect(source).toContain('const walkDog = dogs.find((d) => d.id === walk.dogId) ?? dog;');
    expect(source).toContain('if (!walkDog) return null;');
  });

  // Mascot-notification-experiences round — a real tap must select the
  // stage-appropriate mascot animation (T-15 excited, T playful, T+15
  // waiting, T+30 waiting-escalated), not ReminderMascotPrompt's previous
  // unfiltered random pick.
  it('computes reminderPromptStage from the reminder-open event and passes it to ReminderMascotPrompt', () => {
    expect(source).toContain('reminderStageForNotificationKind(reminderPrompt.kind)');
    const renderIdx = source.indexOf('<ReminderMascotPrompt\n        visible={!!reminderPromptMessage}');
    expect(renderIdx).toBeGreaterThan(-1);
    const block = source.slice(renderIdx, renderIdx + 300);
    expect(block).toContain('stage={reminderPromptStage}');
  });
});
