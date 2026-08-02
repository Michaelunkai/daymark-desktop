import {
  cloneElement,
  useId,
  type HTMLAttributes,
  type ReactElement,
} from "react";

export type TooltipProps = {
  content: string;
  children: ReactElement<HTMLAttributes<HTMLElement>>;
};

export function Tooltip({ content, children }: TooltipProps) {
  const tooltipId = useId();
  const describedBy = [children.props["aria-describedby"], tooltipId]
    .filter(Boolean)
    .join(" ");

  return (
    <span className="ui-tooltip">
      {cloneElement(children, { "aria-describedby": describedBy })}
      <span className="ui-tooltip__content" id={tooltipId} role="tooltip">
        {content}
      </span>
    </span>
  );
}
