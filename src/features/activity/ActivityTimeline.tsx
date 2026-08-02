import { activityKindLabel, formatActivityTime, parseActivityDate } from "./formatters";
import type { ActivityItem } from "./types";
import "./activity.css";

export interface ActivityTimelineProps {
  events: readonly ActivityItem[];
  locale?: string;
  title?: string;
}

export function ActivityTimeline({
  events,
  locale,
  title = "Activity",
}: ActivityTimelineProps) {
  const orderedEvents = [...events].sort((left, right) => {
    const leftTime = parseActivityDate(left.occurredAt)?.getTime() ?? 0;
    const rightTime = parseActivityDate(right.occurredAt)?.getTime() ?? 0;

    return rightTime - leftTime;
  });

  return (
    <section className="activity-panel" aria-labelledby="activity-timeline-title">
      <h3 id="activity-timeline-title" className="activity-panel__title">
        {title}
      </h3>
      {orderedEvents.length === 0 ? (
        <p className="activity-panel__empty">No activity yet.</p>
      ) : (
        <ol className="activity-timeline" aria-label={`${title} history`}>
          {orderedEvents.map((event) => {
            const occurredAt = parseActivityDate(event.occurredAt);

            return (
              <li className="activity-timeline__item" key={event.id}>
                <div className="activity-timeline__marker" aria-hidden="true" />
                <div className="activity-timeline__content">
                  <p className="activity-timeline__summary">
                    <span className="activity-timeline__kind">
                      {activityKindLabel(event.kind)}
                    </span>
                    {event.actorName ? ` by ${event.actorName}` : ""}
                    {`: ${event.message}`}
                  </p>
                  <time
                    className="activity-timeline__time"
                    dateTime={occurredAt?.toISOString()}
                  >
                    {formatActivityTime(event.occurredAt, locale)}
                  </time>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
