import { Children, isValidElement, type ComponentProps } from "react";
import type { ExtraProps } from "react-markdown";
import { UpdateDiagramLightbox } from "./update-diagram-lightbox";

type UpdateMarkdownAnchorProps = ComponentProps<"a"> & ExtraProps;

export function UpdateMarkdownAnchor(props: UpdateMarkdownAnchorProps) {
  const { href, children, className, node, ...anchorProps } = props;
  void node;

  const isDiagram = Boolean(
    href?.startsWith("/") &&
      href.endsWith(".svg") &&
      Children.toArray(children).some(
        (child) => isValidElement(child) && child.type === "img",
      ),
  );

  if (!isDiagram || !href) {
    return (
      <a {...anchorProps} href={href} className={className}>
        {children}
      </a>
    );
  }

  return (
    <UpdateDiagramLightbox
      anchorProps={{ ...anchorProps, className }}
      href={href}
    >
      {children}
    </UpdateDiagramLightbox>
  );
}
