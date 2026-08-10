export type TaskPriority = 1 | 2 | 3 | 4;

export type TaskEditorMode = 'create' | 'edit';

export type TaskEditorOrderLane = 'now' | 'later' | 'after';

export type TaskEditorField = keyof TaskEditorDraft;

export type TaskEditorDraft = {
  title: string;
  description: string;
  projectId: string | null;
  sectionId: string | null;
  priority: TaskPriority;
  dueText: string;
  recurrenceText: string;
  reminderText: string;
  orderLane: TaskEditorOrderLane;
  orderRelationId: string | null;
};

export type TaskEditorOption = {
  id: string;
  label: string;
  color?: string;
  hint?: string;
  projectId?: string;
  disabled?: boolean;
};

export type TaskEditorErrors = Partial<
  Record<TaskEditorField | 'form', string>
>;

export type TaskEditorValidationResult = {
  valid: boolean;
  value: TaskEditorDraft;
  errors: TaskEditorErrors;
};

export type TaskEditorChange<Field extends TaskEditorField = TaskEditorField> = {
  field: Field;
  value: TaskEditorDraft[Field];
};

export type TaskEditorProps = {
  isOpen: boolean;
  draft: TaskEditorDraft;
  mode?: TaskEditorMode;
  projects?: TaskEditorOption[];
  sections?: TaskEditorOption[];
  orderItems?: TaskEditorOption[];
  isSaving?: boolean;
  saveError?: string;
  validationErrors?: TaskEditorErrors;
  presentation?: 'dialog' | 'panel';
  onDraftChange: (
    nextDraft: TaskEditorDraft,
    change: TaskEditorChange,
  ) => void;
  onSave: (draft: TaskEditorDraft) => void;
  onMoveTask?: (draft: TaskEditorDraft) => void;
  onCopyTask?: (draft: TaskEditorDraft) => void;
  onMoveTaskToOrder?: (draft: TaskEditorDraft) => void;
  onCopyTaskToOrder?: (draft: TaskEditorDraft) => void;
  onCancel?: () => void;
  onClose: () => void;
  onRequestProjectPicker?: () => void;
  onRequestReminderPicker?: () => void;
};
