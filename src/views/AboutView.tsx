export function AboutView() {
  return (
    <div className="view">
      <header className="view-header">
        <h1>About Daily Compass</h1>
        <p className="subtitle">
          Daily Compass helps you decide where you are going, organize the work and focus on
          what matters today.
        </p>
      </header>

      <section className="section">
        <h2>How it works</h2>
        <p>
          <strong>Goals define the outcome.</strong>
          <br />
          What do you want to accomplish?
        </p>
        <p>
          <strong>Targets measure progress.</strong>
          <br />
          How will you know the Goal is advancing?
        </p>
        <p>
          <strong>Projects organize the work.</strong>
          <br />
          What body of work will help you reach the Goal?
        </p>
        <p>
          <strong>Tasks are the actions.</strong>
          <br />
          What specifically needs to be done?
        </p>
        <p>For example:</p>
        <ul>
          <li><strong>Goal:</strong> Achieve excellent health and fitness</li>
          <li><strong>Target:</strong> Reach 165 pounds</li>
          <li><strong>Project:</strong> Perfect Body</li>
          <li><strong>Task:</strong> Attend a boxing class</li>
        </ul>
      </section>

      <section className="section">
        <h2>The Compass sections</h2>
        <p>
          <strong>Today</strong>
          <br />
          The Tasks you intend to focus on today.
        </p>
        <p>
          <strong>Tasks</strong>
          <br />
          New, unassigned and individual actions that still need to be organized.
        </p>
        <p>
          <strong>Board</strong>
          <br />
          Move Tasks through Inbox, This Week, Today, In Progress, Waiting and Done.
        </p>
        <p>
          <strong>Projects</strong>
          <br />
          Keep related Tasks together. A Project can be linked to one or more Goals.
        </p>
        <p>
          <strong>Goals</strong>
          <br />
          Define important outcomes and track progress through numeric, yes/no or linked-task
          Targets.
        </p>
        <p>
          <strong>Calendar</strong>
          <br />
          See Tasks according to their due dates.
        </p>
        <p>
          <strong>Daily Compass</strong>
          <br />
          Record notes, think through priorities and decide what deserves your attention.
        </p>
      </section>

      <section className="section">
        <h2>Copy to AI</h2>
        <p>
          Copy to AI creates a clear summary that you can paste into ChatGPT or another AI
          assistant.
        </p>
        <p>You can copy:</p>
        <ul>
          <li>Today&rsquo;s Tasks</li>
          <li>One Project and its linked Goals</li>
          <li>All current work, Goals and Targets</li>
        </ul>
        <p>
          The AI can then help identify priorities, conflicts, overdue work and useful next
          actions. Nothing is sent automatically&mdash;you decide what to copy and where to
          paste it.
        </p>
      </section>

      <section className="section">
        <h2>A simple way to begin</h2>
        <ol>
          <li>Create a Project for an important area of work.</li>
          <li>Add the Tasks you already know need to be done.</li>
          <li>Create a Goal when you can clearly describe the larger outcome.</li>
          <li>Add Targets when you know how progress should be measured.</li>
          <li>Move the most important Tasks into This Week and Today.</li>
          <li>Review your Compass regularly and adjust course when necessary.</li>
        </ol>
        <p>
          You do not need to fill in everything at once. Start with the work in front of you,
          then add structure as it becomes useful.
        </p>
        <p>
          <strong>
            Goals provide direction. Targets show progress. Projects organize the work. Tasks
            move it forward.
          </strong>
        </p>
      </section>
    </div>
  );
}
