import { useState, type FormEvent } from "react";

import { formatActivityTime, parseActivityDate } from "./formatters";
import type { TaskComment } from "./types";
import "./activity.css";

export interface CommentsPanelProps {
  comments: readonly TaskComment[];
  locale?: string;
  onAddComment?: (body: string) => void;
  title?: string;
}

export function CommentsPanel({
  comments,
  locale,
  onAddComment,
  title = "Comments",
}: CommentsPanelProps) {
  const [draft, setDraft] = useState("");
  const orderedComments = [...comments].sort((left, right) => {
    const leftTime = parseActivityDate(left.createdAt)?.getTime() ?? 0;
    const rightTime = parseActivityDate(right.createdAt)?.getTime() ?? 0;

    return leftTime - rightTime;
  });

  function submitComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = draft.trim();

    if (!body) {
      return;
    }

    onAddComment?.(body);
    setDraft("");
  }

  return (
    <section className="activity-panel" aria-labelledby="comments-panel-title">
      <h3 id="comments-panel-title" className="activity-panel__title">
        {title}
      </h3>
      {orderedComments.length === 0 ? (
        <p className="activity-panel__empty">No comments yet.</p>
      ) : (
        <ol className="comments-list" aria-label={`${title} list`}>
          {orderedComments.map((comment) => {
            const createdAt = parseActivityDate(comment.createdAt);

            return (
              <li className="comments-list__item" key={comment.id}>
                <div className="comments-list__meta">
                  <strong>{comment.authorName ?? "You"}</strong>
                  <time dateTime={createdAt?.toISOString()}>
                    {formatActivityTime(comment.createdAt, locale)}
                  </time>
                </div>
                <p>{comment.body}</p>
              </li>
            );
          })}
        </ol>
      )}
      {onAddComment ? (
        <form className="comment-composer" onSubmit={submitComment}>
          <label className="comment-composer__label" htmlFor="task-comment">
            Add a comment
          </label>
          <textarea
            className="comment-composer__input"
            id="task-comment"
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Write a comment"
            rows={3}
            value={draft}
          />
          <div className="comment-composer__actions">
            <button disabled={!draft.trim()} type="submit">
              Comment
            </button>
          </div>
        </form>
      ) : null}
    </section>
  );
}
