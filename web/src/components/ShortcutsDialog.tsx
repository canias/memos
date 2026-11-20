import { Button, Dialog } from "@usememos/ui";
import { XIcon } from "lucide-react";
import { useAppSidebar } from "@/contexts/AppSidebarContext";
import { type Translations, useTranslate } from "@/utils/i18n";
import { primaryModifierGlyph } from "@/utils/platform";

/** The feed and editor shortcuts, grouped the way the cue bar and tooltips name them. */
const SHORTCUT_GROUPS = (modifier: string): { title: Translations; rows: { keys: string[]; label: Translations }[] }[] => [
  {
    title: "shortcut.group.feed",
    rows: [
      { keys: ["j", "↓"], label: "shortcut.feed.next" },
      { keys: ["k", "↑"], label: "shortcut.feed.previous" },
      { keys: ["enter"], label: "shortcut.feed.open" },
      { keys: ["/"], label: "shortcut.feed.search" },
      { keys: ["f"], label: "shortcut.feed.filters" },
      { keys: ["esc"], label: "shortcut.feed.clear" },
      { keys: ["?"], label: "shortcut.feed.cheatsheet" },
    ],
  },
  {
    title: "shortcut.group.editor",
    rows: [
      { keys: [`${modifier}+enter`], label: "shortcut.editor.cycle-task" },
      { keys: ["alt+↑ / alt+↓"], label: "shortcut.editor.move-line" },
      { keys: [`${modifier}+s`], label: "shortcut.editor.save" },
    ],
  },
  {
    title: "shortcut.group.memo",
    rows: [
      { keys: ["2×click"], label: "shortcut.memo.edit-in-place" },
      { keys: ["date"], label: "shortcut.memo.change-date" },
    ],
  },
];

/** The keyboard cheat sheet: every binding with its cue, opened by `?` in a feed. */
const ShortcutsDialog = () => {
  const t = useTranslate();
  const { shortcutsOpen, setShortcutsOpen } = useAppSidebar();
  const modifier = primaryModifierGlyph().toLowerCase();

  return (
    <Dialog.Root open={shortcutsOpen} onOpenChange={setShortcutsOpen}>
      <Dialog.Popup className="max-w-md">
        <div className="flex items-center justify-between gap-4">
          <Dialog.Title>{t("shortcut.title")}</Dialog.Title>
          <Dialog.Close render={<Button variant="ghost" size="sm" icon={<XIcon />} aria-label={t("common.close")} />} />
        </div>
        <div className="flex flex-col gap-4">
          {SHORTCUT_GROUPS(modifier).map((group) => (
            <div key={group.title} className="flex flex-col gap-1.5">
              <p className="mu-label text-mu-text-secondary">{t(group.title)}</p>
              {group.rows.map((row) => (
                <div key={row.label} className="flex items-center justify-between gap-4">
                  <span className="mu-body text-mu-text">{t(row.label)}</span>
                  <span className="flex gap-1">
                    {row.keys.map((key) => (
                      <kbd
                        key={key}
                        className="min-w-7 rounded-mu-sm border border-mu-line bg-mu-well px-1.5 text-center font-mono mu-caption text-mu-text"
                      >
                        {key}
                      </kbd>
                    ))}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </Dialog.Popup>
    </Dialog.Root>
  );
};

export default ShortcutsDialog;
