import cloneDeep from "lodash/cloneDeep";
import { type App, Notice, Setting } from "obsidian";
import { getClient } from "../../src/fsGetter";
import type { TransItemType } from "../../src/i18n";
import type RemotelySavePlugin from "../../src/main";
import { stringToFragment } from "../../src/misc";
import { ChangeRemoteBaseDirModal, wrapTextWithPasswordHide } from "../../src/settings";
import { DEFAULT_FILEN_CONFIG } from "./fsFilen";
import type { FilenAuthType } from "./baseTypesPro";

export const generateFilenSettingsPart = (
  containerEl: HTMLElement,
  t: (x: TransItemType, vars?: any) => string,
  app: App,
  plugin: RemotelySavePlugin,
  saveUpdatedConfigFunc: () => Promise<any> | undefined
) => {
  const filenDiv = containerEl.createEl("div", {
    cls: "filen-hide",
  });
  filenDiv.toggleClass("filen-hide", plugin.settings.serviceType !== "filen");
  filenDiv.createEl("h2", { text: t("settings_filen") });

  const filenLongDescDiv = filenDiv.createEl("div", {
    cls: "settings-long-desc",
  });
  for (const c of [
    t("settings_filen_disclaimer1"),
    t("settings_filen_disclaimer2"),
  ]) {
    filenLongDescDiv.createEl("p", {
      text: c,
      cls: "filen-disclaimer",
    });
  }

  filenLongDescDiv.createEl("p", {
    text: t("settings_filen_folder", {
      remoteBaseDir:
        plugin.settings.filen.remoteBaseDir || app.vault.getName(),
    }),
  });

  filenLongDescDiv.createDiv({
    text: stringToFragment(t("settings_filen_pro_desc")),
    cls: "filen-disclaimer",
  });

  const filenNotShowUpHintSetting = new Setting(filenDiv)
    .setName(t("settings_filen_notshowuphint"))
    .setDesc(t("settings_filen_notshowuphint_desc"))
    .addButton(async (button) => {
      button.setButtonText(t("settings_filen_notshowuphint_view_pro"));
      button.onClick(async () => {
        window.location.href = "#settings-pro";
      });
    });

  const filenAllowedToUsedDiv = filenDiv.createDiv();
  // if pro enabled, show up; otherwise hide.
  const allowFilen =
    plugin.settings.pro?.enabledProFeatures.filter(
      (x) => x.featureName === "feature-filen"
    ).length === 1;
  console.debug(`allow to show up filen settings? ${allowFilen}`);
  if (allowFilen) {
    filenAllowedToUsedDiv.removeClass("filen-allow-to-use-hide");
    filenNotShowUpHintSetting.settingEl.addClass("filen-allow-to-use-hide");
  } else {
    filenAllowedToUsedDiv.addClass("filen-allow-to-use-hide");
    filenNotShowUpHintSetting.settingEl.removeClass(
      "filen-allow-to-use-hide"
    );
  }

  // Auth type chooser
  const authEmailDiv = filenAllowedToUsedDiv.createDiv();
  const authApiKeyDiv = filenAllowedToUsedDiv.createDiv();

  const updateAuthVisibility = (authType: FilenAuthType) => {
    authEmailDiv.toggleClass("filen-auth-hide", authType !== "email");
    authApiKeyDiv.toggleClass("filen-auth-hide", authType !== "apikey");
  };

  new Setting(filenAllowedToUsedDiv)
    .setName(t("settings_filen_authtype"))
    .setDesc(t("settings_filen_authtype_desc"))
    .addDropdown((dropdown) => {
      dropdown.addOption("email", t("settings_filen_authtype_email"));
      dropdown.addOption("apikey", t("settings_filen_authtype_apikey"));
      dropdown
        .setValue(plugin.settings.filen.authType)
        .onChange(async (val) => {
          plugin.settings.filen.authType = val as FilenAuthType;
          updateAuthVisibility(val as FilenAuthType);
          await plugin.saveSettings();
        });
    });

  updateAuthVisibility(plugin.settings.filen.authType);

  // Email field
  new Setting(authEmailDiv)
    .setName(t("settings_filen_email"))
    .setDesc(t("settings_filen_email_desc"))
    .addText((text) =>
      text
        .setPlaceholder("")
        .setValue(plugin.settings.filen.email)
        .onChange(async (val) => {
          plugin.settings.filen.email = val.trim();
          await plugin.saveSettings();
        })
    );

  // Password field
  const passwordSetting = new Setting(authEmailDiv)
    .setName(t("settings_filen_password"))
    .setDesc(t("settings_filen_password_desc"));
  passwordSetting.addText((text) => {
    wrapTextWithPasswordHide(text);
    text
      .setPlaceholder("")
      .setValue(plugin.settings.filen.password)
      .onChange(async (val) => {
        plugin.settings.filen.password = val;
        await plugin.saveSettings();
      });
  });

  // API Key field
  const apiKeySetting = new Setting(authApiKeyDiv)
    .setName(t("settings_filen_apikey"))
    .setDesc(t("settings_filen_apikey_desc"));
  apiKeySetting.addText((text) => {
    wrapTextWithPasswordHide(text);
    text
      .setPlaceholder("")
      .setValue(plugin.settings.filen.apiKey)
      .onChange(async (val) => {
        plugin.settings.filen.apiKey = val.trim();
        await plugin.saveSettings();
      });
  });

  // Clear credentials button
  new Setting(filenAllowedToUsedDiv)
    .setName(t("settings_filen_clear"))
    .setDesc(t("settings_filen_clear_desc"))
    .addButton(async (button) => {
      button.setButtonText(t("settings_filen_clear_button"));
      button.onClick(async () => {
        plugin.settings.filen = cloneDeep(DEFAULT_FILEN_CONFIG);
        await plugin.saveSettings();
        new Notice(t("settings_filen_clear_notice"));
      });
    });

  // Remote base dir
  let newFilenRemoteBaseDir = plugin.settings.filen.remoteBaseDir || "";
  new Setting(filenAllowedToUsedDiv)
    .setName(t("settings_remotebasedir"))
    .setDesc(t("settings_remotebasedir_desc"))
    .addText((text) =>
      text
        .setPlaceholder(app.vault.getName())
        .setValue(newFilenRemoteBaseDir)
        .onChange((value) => {
          newFilenRemoteBaseDir = value.trim();
        })
    )
    .addButton((button) => {
      button.setButtonText(t("confirm"));
      button.onClick(() => {
        new ChangeRemoteBaseDirModal(
          app,
          plugin,
          newFilenRemoteBaseDir,
          "filen"
        ).open();
      });
    });

  // Check connectivity
  new Setting(filenAllowedToUsedDiv)
    .setName(t("settings_checkonnectivity"))
    .setDesc(t("settings_checkonnectivity_desc"))
    .addButton(async (button) => {
      button.setButtonText(t("settings_checkonnectivity_button"));
      button.onClick(async () => {
        new Notice(t("settings_checkonnectivity_checking"));
        const client = getClient(plugin.settings, app.vault.getName(), () =>
          plugin.saveSettings()
        );
        const errors = { msg: "" };
        const res = await client.checkConnect((err: any) => {
          errors.msg = `${err}`;
        });
        if (res) {
          new Notice(t("settings_filen_connect_succ"));
        } else {
          new Notice(t("settings_filen_connect_fail"));
          new Notice(errors.msg);
        }
      });
    });

  return {
    filenDiv: filenDiv,
    filenAllowedToUsedDiv: filenAllowedToUsedDiv,
    filenNotShowUpHintSetting: filenNotShowUpHintSetting,
  };
};
