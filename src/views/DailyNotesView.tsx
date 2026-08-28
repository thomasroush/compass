import { useEffect, useState } from 'react';
import { useApp } from '../store/useApp';
import { getDailyNoteForDate } from '../store/reducer';
import { todayDateString } from '../types';

export function DailyNotesView() {
  const { state, dispatch } = useApp();
  const [date, setDate] = useState(todayDateString());
  const note = getDailyNoteForDate(state.dailyNotes, date);
  const [morning, setMorning] = useState(note?.morning ?? '');
  const [evening, setEvening] = useState(note?.evening ?? '');

  useEffect(() => {
    const n = getDailyNoteForDate(state.dailyNotes, date);
    setMorning(n?.morning ?? '');
    setEvening(n?.evening ?? '');
  }, [date, state.dailyNotes]);

  useEffect(() => {
    const timer = setTimeout(() => {
      dispatch({ type: 'UPSERT_DAILY_NOTE', date, morning, evening });
    }, 400);
    return () => clearTimeout(timer);
  }, [date, morning, evening, dispatch]);

  return (
    <div className="view">
      <header className="view-header">
        <h1>Daily Notes</h1>
        <p className="subtitle">Morning and evening reflections for the selected date.</p>
      </header>

      <div className="field">
        <label htmlFor="note-date">Date</label>
        <input
          id="note-date"
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
      </div>

      <section className="section notes-section">
        <h2>Morning</h2>
        <p className="prompt">What matters most today?</p>
        <p className="prompt">What might get in the way?</p>
        <div className="field">
          <label htmlFor="morning-notes">Morning notes</label>
          <textarea
            id="morning-notes"
            rows={6}
            value={morning}
            onChange={(e) => setMorning(e.target.value)}
          />
        </div>
      </section>

      <section className="section notes-section">
        <h2>Evening</h2>
        <p className="prompt">What was accomplished?</p>
        <p className="prompt">What should carry forward?</p>
        <div className="field">
          <label htmlFor="evening-notes">Evening notes</label>
          <textarea
            id="evening-notes"
            rows={6}
            value={evening}
            onChange={(e) => setEvening(e.target.value)}
          />
        </div>
      </section>
    </div>
  );
}
