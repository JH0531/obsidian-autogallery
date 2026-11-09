import { Modal, Setting } from "obsidian";
import { t } from "./i18n.js";

/** Small confirmation dialog for destructive document-wide actions. */
export class ConfirmModal extends Modal {
  constructor(app, options) {
    super(app);
    this.options = options;
  }

  onOpen() {
    this.modalEl.addClass("ag-confirm-modal");
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: this.options.title });
    if (this.options.message) contentEl.createEl("p", { text: this.options.message });
    new Setting(contentEl)
      .addButton((button) => button
        .setButtonText(this.options.cancelText ?? t("confirm.cancel"))
        .onClick(() => this.close()))
      .addButton((button) => button
        .setButtonText(this.options.confirmText ?? t("confirm.ok"))
        .setWarning()
        .onClick(() => {
          this.close();
          this.options.onConfirm?.();
        }));
  }

  onClose() {
    this.contentEl.empty();
  }
}
