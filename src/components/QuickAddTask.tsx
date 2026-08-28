import { FormEvent, useState } from 'react';
import { useApp } from '../store/useApp';

export function QuickAddTask() {
  const { dispatch } = useApp();
  const [title, setTitle] = useState('');

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) return;
    dispatch({ type: 'ADD_TASK', title: trimmed });
    setTitle('');
  }

  return (
    <form className="quick-add" onSubmit={handleSubmit}>
      <label htmlFor="quick-add-title" className="visually-hidden">
        Add task
      </label>
      <input
        id="quick-add-title"
        type="text"
        placeholder="Add a task..."
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <button type="submit">Add</button>
    </form>
  );
}
