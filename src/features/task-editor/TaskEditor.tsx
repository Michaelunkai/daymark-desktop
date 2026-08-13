import {
  type FormEvent,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';

import {
  parseDateExpression,
  toLocalDate,
  type LocalDate,
} from '../../core/dates';
import { DatePicker } from '../calendar/DatePicker';
import {
  getOrderTransferDestinationError,
  getTaskTransferDestinationError,
  updateTaskEditorDraft,
  validateTaskEditorDraft,
} from './form-state';
import type {
  TaskEditorDraft,
  TaskEditorProps,
  TaskPriority,
} from './types';
import './task-editor.css';

const PRIORITY_OPTIONS: Array<{ value: TaskPriority; label: string }> = [
  { value: 4, label: 'P4 - No priority' },
  { value: 3, label: 'P3 - Low' },
  { value: 2, label: 'P2 - Medium' },
  { value: 1, label: 'P1 - High' },
];

type TransferAction =
  | 'move'
  | 'copy'
  | 'moveToDate'
  | 'copyToDate'
  | 'moveToOrder'
  | 'copyToOrder';

export function TaskEditor({
  isOpen,
  draft,
  mode = 'edit',
  projects = [],
  sections = [],
  isSaving = false,
  saveError,
  validationErrors = {},
  presentation = 'panel',
  onDraftChange,
  onSave,
  onMoveTask,
  onCopyTask,
  onMoveTaskToOrder,
  onCopyTaskToOrder,
  onCancel,
  onClose,
  onRequestProjectPicker,
  onRequestReminderPicker,
}: TaskEditorProps) {
  const titleId = useId().replace(/:/g, '');
  const surfaceRef = useRef<HTMLElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const transferSectionRef = useRef<HTMLElement>(null);
  const [errors, setErrors] = useState<ReturnType<
    typeof validateTaskEditorDraft
  >['errors']>({});
  const [transferAction, setTransferAction] = useState<TransferAction | null>(
    null,
  );
  const [transferTarget, setTransferTarget] = useState({
    projectId: '',
    sectionId: '',
    dueText: draft.dueText,
    orderLane: '',
    orderRelationId: '',
  });
  const [transferError, setTransferError] = useState('');
  const [transferReady, setTransferReady] = useState(false);
  const transferArmTimerRef = useRef<number | null>(null);

  const isOrderTransfer =
    transferAction === 'moveToOrder' || transferAction === 'copyToOrder';
  const isDateTransfer =
    transferAction === 'moveToDate' || transferAction === 'copyToDate';
  const today = toLocalDate(new Date());
  const selectedTransferDate = parseDateExpression(
    transferTarget.dueText,
    today,
  )?.date;
  const availableSections = sections.filter(
    (section) =>
      section.projectId ===
      (transferAction ? transferTarget.projectId : draft.projectId),
  );

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    const previousFocus = document.activeElement as HTMLElement | null;
    const focusTitle = window.requestAnimationFrame(() => {
      titleRef.current?.focus();
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        handleCancel();
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault();
        submitDraft();
        return;
      }

      if (event.key !== 'Tab' || !surfaceRef.current) {
        return;
      }

      const focusable = Array.from(
        surfaceRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );

      if (focusable.length === 0) {
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusTitle);
      document.removeEventListener('keydown', handleKeyDown);
      previousFocus?.focus();
    };
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      return undefined;
    }

    setErrors({});
    setTransferAction(null);
    setTransferTarget({
      projectId: '',
      sectionId: '',
      dueText: '',
      orderLane: '',
      orderRelationId: '',
    });
    setTransferError('');
    setTransferReady(false);
    if (transferArmTimerRef.current !== null) {
      window.clearTimeout(transferArmTimerRef.current);
      transferArmTimerRef.current = null;
    }
    return undefined;
  }, [isOpen]);

  useEffect(() => {
    if (!transferAction) {
      return undefined;
    }

    const frame = window.requestAnimationFrame(() => {
      transferSectionRef.current?.scrollIntoView({
        block: 'start',
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
          ? 'auto'
          : 'smooth',
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [transferAction]);

  if (!isOpen) {
    return null;
  }

  const displayedErrors = { ...validationErrors, ...errors };
  const formError = saveError ?? displayedErrors.form;
  const ids = {
    title: `${titleId}-title`,
    description: `${titleId}-description`,
    project: `${titleId}-project`,
    section: `${titleId}-section`,
    priority: `${titleId}-priority`,
    due: `${titleId}-due`,
    recurrence: `${titleId}-recurrence`,
    reminder: `${titleId}-reminder`,
    error: `${titleId}-error`,
    orderLane: `${titleId}-order-lane`,
  };

  function changeField<Field extends keyof TaskEditorDraft>(
    field: Field,
    value: TaskEditorDraft[Field],
  ) {
    const nextDraft = updateTaskEditorDraft(draft, field, value);
    onDraftChange(nextDraft, { field, value });

    if (errors[field]) {
      setErrors((current) => ({ ...current, [field]: undefined }));
    }
  }

  function changeProject(projectId: string | null) {
    const nextDraft = updateTaskEditorDraft(
      updateTaskEditorDraft(draft, 'projectId', projectId),
      'sectionId',
      null,
    );
    onDraftChange(nextDraft, { field: 'projectId', value: projectId });

    if (errors.projectId || errors.sectionId) {
      setErrors((current) => ({
        ...current,
        projectId: undefined,
        sectionId: undefined,
      }));
    }
  }

  function submitDraft() {
    const result = validateTaskEditorDraft(draft);
    setErrors(result.errors);

    if (!result.valid) {
      titleRef.current?.focus();
      return;
    }

    onSave(result.value);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    submitDraft();
  }

  function handleCancel() {
    onCancel?.();
    onClose();
  }

  function startTransfer(action: TransferAction) {
    if (transferArmTimerRef.current !== null) {
      window.clearTimeout(transferArmTimerRef.current);
      transferArmTimerRef.current = null;
    }
    setTransferAction(action);
    setTransferTarget({
      projectId: '',
      sectionId: '',
      dueText: draft.dueText,
      orderLane: '',
      orderRelationId: '',
    });
    setTransferError('');
    setTransferReady(false);
  }

  function cancelTransfer() {
    if (transferArmTimerRef.current !== null) {
      window.clearTimeout(transferArmTimerRef.current);
      transferArmTimerRef.current = null;
    }
    setTransferAction(null);
    setTransferError('');
    setTransferReady(false);
  }

  function armTransferAction() {
    if (transferArmTimerRef.current !== null) {
      window.clearTimeout(transferArmTimerRef.current);
    }
    setTransferReady(false);
    transferArmTimerRef.current = window.setTimeout(() => {
      setTransferReady(true);
      transferArmTimerRef.current = null;
    }, 300);
  }

  function finishTransfer() {
    if (!transferAction) {
      return;
    }

    if (isOrderTransfer) {
      const destinationError = getOrderTransferDestinationError(
        transferTarget,
      );
      if (destinationError) {
        setTransferError(destinationError);
        return;
      }

      const nextDraft = updateTaskEditorDraft(
        updateTaskEditorDraft(
          draft,
          'orderLane',
          transferTarget.orderLane as TaskEditorDraft['orderLane'],
        ),
        'orderRelationId',
        null,
      );
      if (transferAction === 'moveToOrder') {
        onMoveTaskToOrder?.(nextDraft);
      } else {
        onCopyTaskToOrder?.(nextDraft);
      }
      return;
    }

    const destinationError = getTaskTransferDestinationError(transferTarget);
    if (destinationError) {
      setTransferError(destinationError);
      return;
    }

    const projectId =
      transferTarget.projectId === '__inbox__'
        ? null
        : transferTarget.projectId;
    const sectionId =
      transferTarget.sectionId === '__none__'
        ? null
        : transferTarget.sectionId;
    const nextDraft = updateTaskEditorDraft(
      updateTaskEditorDraft(
        updateTaskEditorDraft(draft, 'projectId', projectId),
        'sectionId',
        sectionId,
      ),
      'dueText',
      transferTarget.dueText,
    );
    if (transferAction === 'move') {
      onMoveTask?.(nextDraft);
    } else {
      onCopyTask?.(nextDraft);
    }
  }

  function finishDateTransfer(date?: LocalDate) {
    if (!date || !isDateTransfer) {
      return;
    }

    const nextDraft = updateTaskEditorDraft(
      draft,
      'dueText',
      dueTextForSelectedDate(draft.dueText, date, today),
    );
    if (transferAction === 'moveToDate') {
      onMoveTask?.(nextDraft);
    } else {
      onCopyTask?.(nextDraft);
    }
  }

  return (
    <div
      className={`task-editor__backdrop task-editor__backdrop--${presentation}`}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          handleCancel();
        }
      }}
    >
      <section
        ref={surfaceRef}
        className={`task-editor__surface task-editor__surface--${presentation}${isDateTransfer ? ' task-editor__surface--date-transfer' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${titleId}-heading`}
        aria-describedby={formError ? ids.error : undefined}
      >
        <header className="task-editor__header">
          <div>
            <p className="task-editor__eyebrow">
              {mode === 'create' ? 'Capture' : 'Task details'}
            </p>
            <h2 id={`${titleId}-heading`}>
              {mode === 'create' ? 'Create task' : 'Edit task'}
            </h2>
          </div>
          <button
            type="button"
            className="task-editor__icon-button"
            aria-label="Close task editor"
            title="Close task editor"
            onClick={handleCancel}
          >
            <CloseIcon />
          </button>
        </header>

        <form className="task-editor__form" onSubmit={handleSubmit} noValidate>
          <div className="task-editor__content">
            <section className="task-editor__section task-editor__section--primary">
              <div className="task-editor__field">
                <label htmlFor={ids.title}>Task title</label>
                <input
                  ref={titleRef}
                  id={ids.title}
                  className="task-editor__title-input"
                  value={draft.title}
                  onChange={(event) =>
                    changeField('title', event.currentTarget.value)
                  }
                  aria-invalid={Boolean(displayedErrors.title)}
                  aria-describedby={
                    displayedErrors.title ? `${ids.title}-error` : undefined
                  }
                  placeholder="What needs doing?"
                  autoComplete="off"
                />
                {displayedErrors.title ? (
                  <span id={`${ids.title}-error`} className="task-editor__error">
                    {displayedErrors.title}
                  </span>
                ) : null}
              </div>

              <div className="task-editor__field">
                <label htmlFor={ids.description}>Description</label>
                <textarea
                  id={ids.description}
                  value={draft.description}
                  onChange={(event) =>
                    changeField('description', event.currentTarget.value)
                  }
                  placeholder="Add context, links, or the next step"
                  rows={12}
                />
              </div>
            </section>

            <section className="task-editor__section">
              <div className="task-editor__section-heading">
                <div>
                  <p className="task-editor__eyebrow">Organize</p>
                  <h3>Where it belongs</h3>
                </div>
                <FolderIcon />
              </div>

              <div className="task-editor__field-grid">
                <div className="task-editor__field">
                  <label htmlFor={ids.project}>Project</label>
                  <div className="task-editor__select-wrap">
                    <select
                      id={ids.project}
                      value={draft.projectId ?? ''}
                      onChange={(event) =>
                        changeProject(event.currentTarget.value || null)
                      }
                    >
                      <option value="">Inbox</option>
                      {projects.map((project) => (
                        <option
                          key={project.id}
                          value={project.id}
                          disabled={project.disabled}
                        >
                          {project.label}
                        </option>
                      ))}
                    </select>
                    <ChevronDownIcon />
                  </div>
                </div>

                <div className="task-editor__field">
                  <label htmlFor={ids.section}>Section</label>
                  <div className="task-editor__select-wrap">
                    <select
                      id={ids.section}
                      value={draft.sectionId ?? ''}
                      onChange={(event) =>
                        changeField(
                          'sectionId',
                          event.currentTarget.value || null,
                        )
                      }
                      disabled={!draft.projectId || availableSections.length === 0}
                      aria-invalid={Boolean(displayedErrors.sectionId)}
                      aria-describedby={
                        displayedErrors.sectionId
                          ? `${ids.section}-error`
                          : undefined
                      }
                    >
                      <option value="">
                        {draft.projectId
                          ? availableSections.length
                            ? 'No section'
                            : 'No sections'
                          : 'Choose a project first'}
                      </option>
                      {availableSections.map((section) => (
                        <option
                          key={section.id}
                          value={section.id}
                          disabled={section.disabled}
                        >
                          {section.label}
                        </option>
                      ))}
                    </select>
                    <ChevronDownIcon />
                  </div>
                  {displayedErrors.sectionId ? (
                    <span id={`${ids.section}-error`} className="task-editor__error">
                      {displayedErrors.sectionId}
                    </span>
                  ) : null}
                </div>
              </div>

              {onRequestProjectPicker ? (
                <button
                  type="button"
                  className="task-editor__text-button"
                  onClick={onRequestProjectPicker}
                >
                  <PlusIcon />
                  Manage projects
                </button>
              ) : null}
            </section>

            {mode === 'edit' && transferAction ? (
              <section ref={transferSectionRef} className="task-editor__section task-editor__section--transfer">
                <div className="task-editor__section-heading">
                  <div>
                    <p className="task-editor__eyebrow">Transfer</p>
                    <h3>
                      {isDateTransfer
                        ? transferAction === 'moveToDate'
                          ? 'Move to a calendar date'
                          : 'Copy to a calendar date'
                        : isOrderTransfer
                        ? 'Choose the Order section'
                        : 'Choose the task destination'}
                    </h3>
                  </div>
                  {isDateTransfer ? <CalendarIcon /> : <MoveIcon />}
                </div>
                {isDateTransfer ? (
                  <div className="task-editor__date-transfer">
                    <div className="task-editor__date-transfer-intro">
                      <strong>
                        {transferAction === 'moveToDate'
                          ? 'Choose the new day'
                          : 'Choose the day for the copy'}
                      </strong>
                      <span>
                        Clicking a date completes the action immediately.
                      </span>
                    </div>
                    <DatePicker
                      value={selectedTransferDate}
                      today={today}
                      label={
                        transferAction === 'moveToDate'
                          ? 'Move task to date'
                          : 'Copy task to date'
                      }
                      showTextEntry={false}
                      allowClear={false}
                      onDismiss={cancelTransfer}
                      onChange={(date) => finishDateTransfer(date)}
                    />
                  </div>
                ) : isOrderTransfer ? (
                  <>
                    <div className="task-editor__field">
                      <label htmlFor={ids.orderLane}>Order section</label>
                      <div className="task-editor__select-wrap">
                        <select
                          id={ids.orderLane}
                          value={transferTarget.orderLane}
                          onChange={(event) => {
                            const orderLane = event.currentTarget.value;
                            setTransferError('');
                            setTransferTarget((current) => ({
                              ...current,
                              orderLane,
                              orderRelationId: '',
                            }));
                            armTransferAction();
                          }}
                        >
                          <option value="">Choose an Order section</option>
                          <option value="now">Do now</option>
                          <option value="later">Later</option>
                          <option value="after">After</option>
                        </select>
                        <ChevronDownIcon />
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                  <div className="task-editor__field-grid">
                    <div className="task-editor__field">
                      <label htmlFor={ids.project}>Project</label>
                      <div className="task-editor__select-wrap">
                        <select
                          id={ids.project}
                          value={transferTarget.projectId}
                          onChange={(event) => {
                            const projectId = event.currentTarget.value;
                            setTransferError('');
                            setTransferTarget((current) => ({
                              ...current,
                              projectId,
                              sectionId: '',
                            }));
                            setTransferReady(false);
                          }}
                        >
                          <option value="">Choose Inbox or a project</option>
                          <option value="__inbox__">Inbox</option>
                          {projects.map((project) => (
                            <option
                              key={project.id}
                              value={project.id}
                              disabled={project.disabled}
                            >
                              {project.label}
                            </option>
                          ))}
                        </select>
                        <ChevronDownIcon />
                      </div>
                    </div>
                    <div className="task-editor__field">
                      <label htmlFor={ids.section}>Section</label>
                      <div className="task-editor__select-wrap">
                        <select
                          id={ids.section}
                          value={transferTarget.sectionId}
                          disabled={!transferTarget.projectId}
                          onChange={(event) => {
                            const sectionId = event.currentTarget.value;
                            setTransferError('');
                            setTransferTarget((current) => ({
                              ...current,
                              sectionId,
                            }));
                            armTransferAction();
                          }}
                        >
                          <option value="">Choose a section</option>
                          <option value="__none__">No section</option>
                          {availableSections.map((section) => (
                            <option
                              key={section.id}
                              value={section.id}
                              disabled={section.disabled}
                            >
                              {section.label}
                            </option>
                          ))}
                        </select>
                        <ChevronDownIcon />
                      </div>
                    </div>
                  </div>
                  <div className="task-editor__field task-editor__field--transfer-date">
                    <label htmlFor={`${ids.due}-transfer`}>Schedule destination</label>
                    <div className="task-editor__date-shortcuts" role="group" aria-label="Quick destination dates">
                      <button
                        type="button"
                        onClick={() => {
                          setTransferTarget((current) => ({ ...current, dueText: 'today' }));
                          armTransferAction();
                        }}
                      >
                        Today
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setTransferTarget((current) => ({ ...current, dueText: 'tomorrow' }));
                          armTransferAction();
                        }}
                      >
                        Tomorrow
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setTransferTarget((current) => ({ ...current, dueText: '' }));
                          armTransferAction();
                        }}
                      >
                        No date
                      </button>
                    </div>
                    <div className="task-editor__input-with-icon">
                      <CalendarIcon />
                      <input
                        id={`${ids.due}-transfer`}
                        value={transferTarget.dueText}
                        onChange={(event) => {
                          const dueText = event.currentTarget.value;
                          setTransferTarget((current) => ({ ...current, dueText }));
                          armTransferAction();
                        }}
                        placeholder="e.g. today or 2026-12-31"
                        autoComplete="off"
                      />
                    </div>
                  </div>
                  </>
                )}
                {transferError ? (
                  <p className="task-editor__form-error" role="alert">
                    {transferError}
                  </p>
                ) : null}
              </section>
            ) : null}

            <section className="task-editor__section">
              <div className="task-editor__section-heading">
                <div>
                  <p className="task-editor__eyebrow">Signal</p>
                  <h3>Priority</h3>
                </div>
              </div>

              <div className="task-editor__field">
                <label htmlFor={ids.priority}>Priority</label>
                <div className="task-editor__priority-control">
                  <PriorityMark priority={draft.priority} />
                  <select
                    id={ids.priority}
                    value={draft.priority}
                    onChange={(event) =>
                      changeField(
                        'priority',
                        Number(event.currentTarget.value) as TaskPriority,
                      )
                    }
                  >
                    {PRIORITY_OPTIONS.map((priority) => (
                      <option key={priority.value} value={priority.value}>
                        {priority.label}
                      </option>
                    ))}
                  </select>
                  <ChevronDownIcon />
                </div>
              </div>

            </section>

            <section className="task-editor__section">
              <div className="task-editor__section-heading">
                <div>
                  <p className="task-editor__eyebrow">Schedule</p>
                  <h3>Make time for it</h3>
                </div>
                <CalendarIcon />
              </div>

              <div className="task-editor__field">
                <label htmlFor={ids.due}>Due date</label>
                <div className="task-editor__input-with-icon">
                  <CalendarIcon />
                  <input
                    id={ids.due}
                    value={draft.dueText}
                    onChange={(event) =>
                      changeField('dueText', event.currentTarget.value)
                    }
                    placeholder="e.g. tomorrow at 4pm"
                    autoComplete="off"
                  />
                </div>
              </div>

              <div className="task-editor__field-grid">
                <div className="task-editor__field">
                  <label htmlFor={ids.recurrence}>Repeat</label>
                  <div className="task-editor__input-with-icon">
                    <RepeatIcon />
                    <input
                      id={ids.recurrence}
                      value={draft.recurrenceText}
                      onChange={(event) =>
                        changeField('recurrenceText', event.currentTarget.value)
                      }
                      placeholder="e.g. every Friday"
                      autoComplete="off"
                    />
                  </div>
                </div>

                <div className="task-editor__field">
                  <label htmlFor={ids.reminder}>Reminder</label>
                  <div className="task-editor__input-with-icon">
                    <BellIcon />
                    <input
                      id={ids.reminder}
                      value={draft.reminderText}
                      onChange={(event) =>
                        changeField('reminderText', event.currentTarget.value)
                      }
                      placeholder="Optional"
                      autoComplete="off"
                    />
                  </div>
                </div>
              </div>

              {onRequestReminderPicker ? (
                <button
                  type="button"
                  className="task-editor__text-button"
                  onClick={onRequestReminderPicker}
                >
                  <BellIcon />
                  Open reminder picker
                </button>
              ) : null}
            </section>
          </div>

          {formError ? (
            <p id={ids.error} className="task-editor__form-error" role="alert">
              {formError}
            </p>
          ) : null}

          <footer className="task-editor__footer">
            {mode === 'edit' &&
            !transferAction &&
            (onMoveTask ||
              onCopyTask ||
              onMoveTaskToOrder ||
              onCopyTaskToOrder) ? (
              <div className="task-editor__transfer-actions">
                {onMoveTask ? (
                  <button
                    type="button"
                    className="task-editor__button task-editor__button--secondary"
                    onClick={() => startTransfer('move')}
                    disabled={isSaving}
                  >
                    <MoveIcon />
                    Move task
                  </button>
                ) : null}
                {onCopyTask ? (
                  <button
                    type="button"
                    className="task-editor__button task-editor__button--secondary"
                    onClick={() => startTransfer('copy')}
                    disabled={isSaving}
                  >
                    <CopyIcon />
                    Copy task
                  </button>
                ) : null}
                {onMoveTask ? (
                  <button
                    type="button"
                    className="task-editor__button task-editor__button--secondary"
                    onClick={() => startTransfer('moveToDate')}
                    disabled={isSaving}
                  >
                    <CalendarMoveIcon />
                    Move to date
                  </button>
                ) : null}
                {onCopyTask ? (
                  <button
                    type="button"
                    className="task-editor__button task-editor__button--secondary"
                    onClick={() => startTransfer('copyToDate')}
                    disabled={isSaving}
                  >
                    <CalendarCopyIcon />
                    Copy to date
                  </button>
                ) : null}
                {onMoveTaskToOrder ? (
                  <button
                    type="button"
                    className="task-editor__button task-editor__button--secondary"
                    onClick={() => startTransfer('moveToOrder')}
                    disabled={isSaving}
                  >
                    <MoveIcon />
                    Move to Order
                  </button>
                ) : null}
                {onCopyTaskToOrder ? (
                  <button
                    type="button"
                    className="task-editor__button task-editor__button--secondary"
                    onClick={() => startTransfer('copyToOrder')}
                    disabled={isSaving}
                  >
                    <CopyIcon />
                    Copy to Order
                  </button>
                ) : null}
              </div>
            ) : null}
            {mode === 'edit' && transferAction && isDateTransfer ? (
              <div className="task-editor__date-transfer-footer">
                <span>Select a date above to complete the action.</span>
                <button
                  type="button"
                  className="task-editor__button task-editor__button--secondary"
                  onClick={cancelTransfer}
                  disabled={isSaving}
                >
                  Cancel transfer
                </button>
              </div>
            ) : mode === 'edit' && transferAction ? (
              <div className="task-editor__transfer-actions">
                <button
                  type="button"
                  className="task-editor__button task-editor__button--secondary"
                  onClick={cancelTransfer}
                  disabled={isSaving}
                >
                  Cancel transfer
                </button>
                <button
                  type="button"
                  className="task-editor__button task-editor__button--primary"
                  onClick={finishTransfer}
                  disabled={isSaving || !transferReady}
                >
                  {isOrderTransfer
                    ? transferAction === 'moveToOrder'
                      ? 'Move to Order'
                      : 'Copy to Order'
                    : transferAction === 'move'
                      ? 'Move task'
                      : 'Copy task'}
                </button>
              </div>
            ) : null}
            {!transferAction ? (
              <div className="task-editor__actions">
                <button
                  type="button"
                  className="task-editor__button task-editor__button--secondary"
                  onClick={handleCancel}
                  disabled={isSaving}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="task-editor__button task-editor__button--primary"
                  disabled={isSaving}
                >
                  {isSaving
                    ? 'Saving...'
                    : mode === 'create'
                      ? 'Create task'
                      : 'Save changes'}
                </button>
              </div>
            ) : null}
          </footer>
        </form>
      </section>
    </div>
  );
}

function dueTextForSelectedDate(
  currentDueText: string,
  date: LocalDate,
  today: LocalDate,
) {
  const parsed = parseDateExpression(currentDueText, today);
  if (!parsed?.time) {
    return date;
  }

  const [hourText, minuteText = '00'] = parsed.time.split(':');
  const hour = Number(hourText);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    return date;
  }

  const suffix = hour >= 12 ? 'pm' : 'am';
  const hour12 = hour % 12 || 12;
  return `${date} at ${hour12}:${minuteText} ${suffix}`;
}

function PriorityMark({ priority }: { priority: TaskPriority }) {
  return (
    <span
      className={`task-editor__priority-mark task-editor__priority-mark--p${priority}`}
      aria-hidden="true"
    >
      P{priority}
    </span>
  );
}

function Icon({
  children,
  size = 18,
}: {
  children: ReactNode;
  size?: number;
}) {
  return (
    <svg
      aria-hidden="true"
      className="task-editor__icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

function CloseIcon() {
  return (
    <Icon>
      <path d="m7 7 10 10M17 7 7 17" />
    </Icon>
  );
}

function ChevronDownIcon() {
  return (
    <Icon size={16}>
      <path d="m6 9 6 6 6-6" />
    </Icon>
  );
}

function FolderIcon() {
  return (
    <Icon>
      <path d="M3.5 7.5h6l1.8 2h9.2v8.7a1.8 1.8 0 0 1-1.8 1.8H5.3a1.8 1.8 0 0 1-1.8-1.8Z" />
      <path d="M3.5 7.5V5.8A1.8 1.8 0 0 1 5.3 4h4l1.8 2h4.2" />
    </Icon>
  );
}

function TagIcon() {
  return (
    <Icon>
      <path d="m4 5 .6 6.1 7.8 7.8a2.1 2.1 0 0 0 3 0l3.5-3.5a2.1 2.1 0 0 0 0-3L11.1 4.6Z" />
      <circle cx="8" cy="8" r="1.1" />
    </Icon>
  );
}

function CalendarIcon() {
  return (
    <Icon>
      <rect x="4" y="5.5" width="16" height="15" rx="2" />
      <path d="M8 3.5v4M16 3.5v4M4 9.5h16" />
    </Icon>
  );
}

function RepeatIcon() {
  return (
    <Icon>
      <path d="M17 4.5h2.5v5M19.5 9.5l-3-3" />
      <path d="M19.2 9.5A7.5 7.5 0 0 0 5.4 7M7 19.5H4.5v-5M4.5 14.5l3 3" />
      <path d="M4.8 14.5A7.5 7.5 0 0 0 18.6 17" />
    </Icon>
  );
}

function BellIcon() {
  return (
    <Icon>
      <path d="M18 9.5a6 6 0 0 0-12 0c0 6-2.3 6.2-2.3 7.4h16.6C20.3 15.7 18 15.5 18 9.5Z" />
      <path d="M10 20h4" />
    </Icon>
  );
}

function PlusIcon() {
  return (
    <Icon size={15}>
      <path d="M12 5v14M5 12h14" />
    </Icon>
  );
}

function MoveIcon() {
  return (
    <Icon size={16}>
      <path d="M5 7h10" />
      <path d="m12 4 3 3-3 3" />
      <path d="M19 17H9" />
      <path d="m12 14-3 3 3 3" />
    </Icon>
  );
}

function CopyIcon() {
  return (
    <Icon size={16}>
      <rect x="8" y="8" width="11" height="11" rx="1.5" />
      <path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8" />
    </Icon>
  );
}

function CalendarMoveIcon() {
  return (
    <Icon size={16}>
      <rect x="3.5" y="5.5" width="13" height="14" rx="2" />
      <path d="M7 3.5v4M13 3.5v4M3.5 9.5h13M18 13h3M19.5 11.5 21 13l-1.5 1.5" />
    </Icon>
  );
}

function CalendarCopyIcon() {
  return (
    <Icon size={16}>
      <rect x="3.5" y="5.5" width="12" height="13" rx="2" />
      <path d="M7 3.5v4M12 3.5v4M3.5 9.5h12M17 14h4M19 12v4" />
    </Icon>
  );
}
