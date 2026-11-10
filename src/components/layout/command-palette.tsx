"use client";

import { Search, X } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { getPaletteCommands, type PaletteCommand } from "./command-palette-commands";

/** Selector for elements the Tab trap may move focus to. */
const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface PaletteStatus {
  message: string;
  tone: "success" | "error";
}

/**
 * Global Ctrl/Cmd+K command palette (T83).
 *
 * It is mounted once in `AppShell` and renders nothing until the shortcut is
 * pressed, so it cannot shift the layout. The overlay is fixed and the list is
 * a combobox/listbox pair: focus stays in the search input, `aria-activedescendant`
 * tracks the highlighted option, and arrow keys move the highlight. `Tab` is
 * trapped between the input and the close button, and closing restores focus to
 * whatever was focused before the palette opened.
 *
 * Only navigation and the non-destructive "copy current page link" action are
 * offered. Escape closes, Enter runs the highlighted command, and no transition
 * is required, so reduced-motion users see the same interface without motion.
 */
export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [status, setStatus] = useState<PaletteStatus | null>(null);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const openRef = useRef(false);

  const titleId = useId();
  const descriptionId = useId();
  const inputId = useId();
  const listboxId = useId();

  const commands = useMemo(() => getPaletteCommands(query), [query]);
  const activeCommand = commands[activeIndex];

  // The shortcut is global: it also works while focus is in another search
  // field, but it is ignored when the palette is already open.
  useEffect(() => {
    function handleGlobalKeyDown(event: globalThis.KeyboardEvent) {
      if (
        (event.ctrlKey || event.metaKey) &&
        !event.altKey &&
        event.key.toLocaleLowerCase("en") === "k"
      ) {
        event.preventDefault();

        if (openRef.current) {
          return;
        }

        openRef.current = true;
        setStatus(null);
        setQuery("");
        setActiveIndex(0);
        setOpen(true);
      }
    }

    window.addEventListener("keydown", handleGlobalKeyDown);

    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, []);

  // Capture the opener and move focus into the field; restore it on close. The
  // cleanup also runs on unmount, which covers a route change while open.
  useEffect(() => {
    if (!open) {
      return;
    }

    const active = document.activeElement;

    returnFocusRef.current = active instanceof HTMLElement ? active : null;
    inputRef.current?.focus();

    return () => {
      const target = returnFocusRef.current;

      returnFocusRef.current = null;

      if (target?.isConnected === true) {
        target.focus();
      }
    };
  }, [open]);

  // Keep the highlighted row visible without moving focus out of the input.
  useEffect(() => {
    const activeOption = listRef.current?.querySelector<HTMLElement>(
      `[data-index="${activeIndex}"]`,
    );

    activeOption?.scrollIntoView?.({ block: "nearest" });
  }, [activeIndex, commands]);

  function closePalette() {
    openRef.current = false;
    setOpen(false);
    setQuery("");
    setActiveIndex(0);
  }

  async function copyCurrentPageLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);

      setStatus({ message: "Current page link copied to clipboard.", tone: "success" });
      closePalette();
    } catch {
      setStatus({ message: "Could not copy the current page link.", tone: "error" });
    }
  }

  function runCommand(command: PaletteCommand | undefined) {
    if (command === undefined) {
      return;
    }

    if (command.action === "copy-current-page-link") {
      void copyCurrentPageLink();
      return;
    }

    if (command.href !== undefined) {
      closePalette();
      router.push(command.href);
    }
  }

  function handleInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();

      if (commands.length > 0) {
        setActiveIndex((index) => (index + 1) % commands.length);
      }

      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();

      if (commands.length > 0) {
        setActiveIndex((index) => (index - 1 + commands.length) % commands.length);
      }

      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      runCommand(activeCommand);
    }
  }

  function handleDialogKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closePalette();
      return;
    }

    if (event.key !== "Tab") {
      return;
    }

    const panel = panelRef.current;

    if (panel === null) {
      return;
    }

    const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));

    if (focusable.length === 0) {
      event.preventDefault();
      panel.focus();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;

    if (event.shiftKey) {
      // Shift+Tab from the panel itself or its first control wraps to the end.
      if (active === first || active === panel) {
        event.preventDefault();
        last.focus();
      }

      return;
    }

    if (active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function handleBackdropClick(event: MouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget) {
      closePalette();
    }
  }

  return (
    <>
      {open ? (
        <div
          data-slot="command-palette-overlay"
          className="overscroll-contain fixed inset-0 z-50 flex items-start justify-center bg-black/70 p-4 pt-[max(1rem,10vh)] sm:p-6 sm:pt-[12vh]"
          onClick={handleBackdropClick}
        >
          <div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={descriptionId}
            aria-keyshortcuts="Control+K Meta+K"
            tabIndex={-1}
            onKeyDown={handleDialogKeyDown}
            className="flex max-h-[calc(100dvh-2rem)] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-2xl outline-none"
          >
            <h2 id={titleId} className="sr-only">
              Command palette
            </h2>
            <p id={descriptionId} className="sr-only">
              Search for a page or action. Use the arrow keys to choose, Enter to run, and Escape to
              close.
            </p>

            <div className="flex shrink-0 items-center gap-2 border-b border-border px-4">
              <Search aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />

              <label htmlFor={inputId} className="sr-only">
                Search commands and pages
              </label>
              <input
                ref={inputRef}
                id={inputId}
                type="text"
                role="combobox"
                aria-expanded={true}
                aria-haspopup="listbox"
                aria-controls={listboxId}
                aria-autocomplete="list"
                aria-activedescendant={
                  activeCommand === undefined ? undefined : `${listboxId}-${activeCommand.id}`
                }
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setActiveIndex(0);
                }}
                onKeyDown={handleInputKeyDown}
                placeholder="Search commands and pages…"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
                className="h-14 min-w-0 flex-1 rounded-sm bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring focus:ring-offset-0"
              />

              <Button
                type="button"
                variant="ghost"
                size="icon-lg"
                aria-label="Close command palette"
                onClick={closePalette}
                className="size-11 shrink-0"
              >
                <X aria-hidden="true" />
              </Button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              {commands.length === 0 ? (
                <p role="status" className="px-3 py-8 text-center text-sm text-muted-foreground">
                  No matching commands.
                </p>
              ) : (
                <ul
                  ref={listRef}
                  id={listboxId}
                  role="listbox"
                  aria-label="Commands"
                  className="flex flex-col gap-0.5"
                >
                  {commands.map((command, index) => {
                    const Icon = command.icon;
                    const isActive = index === activeIndex;

                    return (
                      <li
                        key={command.id}
                        id={`${listboxId}-${command.id}`}
                        role="option"
                        aria-selected={isActive}
                        aria-label={command.title}
                        data-index={index}
                        data-active={isActive}
                        // Keep focus in the combobox so the active-descendant
                        // relationship survives a pointer click.
                        onMouseDown={(event) => event.preventDefault()}
                        onMouseEnter={() => setActiveIndex(index)}
                        onClick={() => runCommand(command)}
                        className={cn(
                          "flex min-h-11 cursor-pointer items-center gap-3 rounded-md border border-transparent px-3 py-2 text-sm outline-none transition-colors",
                          isActive
                            ? "border-ring bg-accent text-accent-foreground ring-1 ring-inset ring-ring"
                            : "text-foreground hover:bg-muted",
                        )}
                      >
                        <Icon
                          aria-hidden="true"
                          className={cn(
                            "size-4 shrink-0",
                            isActive ? "text-accent-foreground" : "text-muted-foreground",
                          )}
                        />

                        <span className="min-w-0 flex-1 truncate">{command.title}</span>

                        <span
                          aria-hidden="true"
                          className={cn(
                            "shrink-0 text-[0.7rem] font-medium tracking-wide uppercase",
                            isActive ? "text-accent-foreground/80" : "text-muted-foreground",
                          )}
                        >
                          {command.group}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {status === null ? null : (
              <p
                role={status.tone === "error" ? "alert" : "status"}
                className={cn(
                  "shrink-0 border-t border-border px-4 py-2 text-sm",
                  status.tone === "error" ? "text-destructive" : "text-muted-foreground",
                )}
              >
                {status.message}
              </p>
            )}

            <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-border px-3 py-2 text-xs text-muted-foreground">
              <span className="flex flex-wrap items-center gap-1.5">
                <kbd className="inline-flex min-w-5 items-center justify-center rounded border border-border bg-muted px-1 py-0.5 font-mono text-[0.7rem]">
                  ↑
                </kbd>
                <kbd className="inline-flex min-w-5 items-center justify-center rounded border border-border bg-muted px-1 py-0.5 font-mono text-[0.7rem]">
                  ↓
                </kbd>
                <span>to navigate</span>
                <kbd className="ml-1 inline-flex items-center justify-center rounded border border-border bg-muted px-1 py-0.5 font-mono text-[0.7rem]">
                  Enter
                </kbd>
                <span>to select</span>
              </span>
              <span className="flex items-center gap-1.5">
                <kbd className="inline-flex items-center justify-center rounded border border-border bg-muted px-1 py-0.5 font-mono text-[0.7rem]">
                  Esc
                </kbd>
                <span>to close</span>
              </span>
            </div>
          </div>
        </div>
      ) : null}

      {status !== null && !open ? (
        <p role="status" aria-live="polite" className="sr-only">
          {status.message}
        </p>
      ) : null}
    </>
  );
}
