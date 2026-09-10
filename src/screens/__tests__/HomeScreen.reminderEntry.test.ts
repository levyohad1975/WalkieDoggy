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
    expect(source).toContain('dogName: dog.name');
    expect(source).toContain('dogSex: dog.sex');
  });
});
