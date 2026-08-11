/*
 * Family Planner Panel
 * -----------------------------------------------------------------------
 * Fristående sida i Home Assistants sidopanel för att bygga upp all
 * konfiguration (titel, nedräkningar, väder, personer, kalendrar,
 * ikon-nyckelord, månadskalender, semestermarkering, TTS, allmänna
 * sensorer) som Family Planner Card läser automatiskt - kortet har
 * ingen egen konfiguration, se dess setConfig()/_maybeLoadSharedConfig().
 *
 * Den här filen serveras och registreras av den medföljande Python-
 * integrationen (custom_components/family_planner) - installera den via
 * HACS (kategori "Integration") eller manuellt, lägg till den under
 * Inställningar → Enheter & tjänster → Lägg till integration →
 * "Family Planner", så sköter integrationen resten (statisk sökväg +
 * sidopanel-registrering). Ingen manuell panel_custom-rad i
 * configuration.yaml behövs.
 *
 * Data sparas via websocket-kommandona family_planner/get_config och
 * family_planner/save_config, som integrationen registrerar - lagras i
 * HA:s egen storage (.storage/family_planner_config), delat mellan alla
 * användare på instansen (till skillnad från frontend/user_data, som är
 * knutet till en enskild inloggad användare).
 */

function fpcEsc(str) {
  return String(str == null ? "" : str)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function isImagePath(str) {
  if (!str) return false;
  if (/^https?:\/\//i.test(str)) return true;
  if (str.startsWith("/")) return true;
  return /\.(png|jpe?g|gif|webp|svg)$/i.test(str);
}

// Nyckel som binder en person till en "borta hos andra föräldern"-kalender
// (away_calendars[].persons) - namnet om satt, annars person_entity-id:t.
// Måste hållas i synk med samma funktion i family-planner-card.js.
function personMatchKey(p) {
  return (p && (p.name || p.person_entity)) || "";
}

function renderIconBadge(icon) {
  if (!icon) return "";
  if (icon.startsWith("mdi:")) {
    return `<ha-icon class="fpp-kw-icon" icon="${icon}"></ha-icon>`;
  }
  if (isImagePath(icon)) {
    return `<img class="fpp-kw-image" src="${icon}" alt="" />`;
  }
  return `<span class="fpp-kw-emoji">${icon}</span>`;
}

// Förhandsvisning för ett nyckelord som kan ha både `icon` och `image`
// satta samtidigt - bilden vinner om den finns. Måste hållas i synk med
// renderKeywordBadge i family-planner-card.js.
function renderKeywordBadge(kw) {
  if (!kw) return "";
  if (kw.image) return `<img class="fpp-kw-image" src="${kw.image}" alt="" />`;
  return renderIconBadge(kw.icon);
}

class FamilyPlannerPanel extends HTMLElement {
  constructor() {
    super();
    this._data = this._defaultData();
    this._loaded = false;
    this._dirty = false;
    this._saving = false;
    this._saveError = false;
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._loaded) {
      this._loaded = true;
      this._load();
    } else {
      this.querySelectorAll("ha-entity-picker").forEach((el) => {
        el.hass = hass;
      });
    }
  }

  set narrow(narrow) {
    this._narrow = narrow;
    this._updateMenuButton();
  }

  set route(route) {
    this._route = route;
  }

  set panel(panel) {
    this._panel = panel;
  }

  // Delas mellan konstruktorns startläge och _load() - håller defaults på
  // ett ställe, samma fält som Family Planner Card förväntar sig från
  // family_planner/get_config (se _maybeLoadSharedConfig i kortet).
  _defaultData() {
    return {
      title: "Familjeplanering",
      start_collapsed: false,
      countdowns: { max_shown: 5, items: [] },
      weather: { entity: "", show_week: false },
      persons: [],
      calendars: [],
      calendars_label: "Övrigt",
      away_calendars: [],
      icon_keywords: [],
      show_month_calendar: true,
      vacation_keywords: [],
      tts: { tts_entity: "", media_player: "" },
      general: [],
    };
  }

  async _load() {
    try {
      const result = await this._hass.callWS({ type: "family_planner/get_config" });
      const value = result && result.value;
      if (value) {
        const countdownCfg = value.countdowns || {};
        const weatherCfg = value.weather || {};
        const ttsCfg = value.tts || {};
        this._data = {
          title: value.title || "Familjeplanering",
          start_collapsed: !!value.start_collapsed,
          countdowns: {
            max_shown: Number.isFinite(countdownCfg.max_shown) ? countdownCfg.max_shown : 5,
            items: Array.isArray(countdownCfg.items) ? countdownCfg.items : [],
          },
          weather: { entity: weatherCfg.entity || "", show_week: !!weatherCfg.show_week },
          persons: Array.isArray(value.persons) ? value.persons : [],
          calendars: Array.isArray(value.calendars) ? value.calendars : [],
          calendars_label: value.calendars_label || "Övrigt",
          away_calendars: Array.isArray(value.away_calendars) ? value.away_calendars : [],
          icon_keywords: Array.isArray(value.icon_keywords) ? value.icon_keywords : [],
          show_month_calendar: value.show_month_calendar !== false,
          vacation_keywords: Array.isArray(value.vacation_keywords) ? value.vacation_keywords : [],
          tts: { tts_entity: ttsCfg.tts_entity || "", media_player: ttsCfg.media_player || "" },
          general: Array.isArray(value.general) ? value.general : [],
        };
      }
    } catch (err) {
      // Inget sparat än - kör med tomt startläge.
    }
    this._render();
  }

  async _save() {
    if (!this._hass) return;
    this._saving = true;
    this._saveError = false;
    this._updateStatus();
    try {
      await this._hass.callWS({
        type: "family_planner/save_config",
        value: this._data,
      });
      this._dirty = false;
    } catch (err) {
      this._saveError = true;
    }
    this._saving = false;
    this._updateStatus();
  }

  _markDirty() {
    this._dirty = true;
    this._saveError = false;
    this._updateStatus();
  }

  _updateStatus() {
    const el = this.querySelector("#fpp-status");
    const btn = this.querySelector("#fpp-save-btn");
    if (!el || !btn) return;
    if (this._saving) {
      el.textContent = "Sparar…";
    } else if (this._saveError) {
      el.textContent = "Kunde inte spara - försök igen.";
    } else if (this._dirty) {
      el.textContent = "Osparade ändringar";
    } else {
      el.textContent = "Sparat";
    }
    btn.disabled = this._saving;
  }

  _updateMenuButton() {
    const btn = this.querySelector("#fpp-menu-btn");
    if (btn) btn.style.display = this._narrow ? "" : "none";
  }

  _toggleMenu() {
    this.dispatchEvent(new CustomEvent("hass-toggle-menu", { bubbles: true, composed: true }));
  }

  _mkEntityPicker(value, onChange, placeholder, includeDomains) {
    if (customElements.get("ha-entity-picker")) {
      const picker = document.createElement("ha-entity-picker");
      picker.hass = this._hass;
      picker.value = value || "";
      picker.allowCustomEntity = true;
      if (includeDomains && includeDomains.length) picker.includeDomains = includeDomains;
      picker.style.flex = "1";
      picker.addEventListener("value-changed", (ev) => {
        ev.stopPropagation();
        onChange(ev.detail.value || "");
      });
      return picker;
    }
    const input = document.createElement("input");
    input.type = "text";
    input.value = value || "";
    input.placeholder = placeholder || "entity_id";
    input.style.flex = "1";
    input.addEventListener("change", (ev) => onChange(ev.target.value));
    return input;
  }

  _row(children) {
    const row = document.createElement("div");
    row.className = "fpp-row";
    children.forEach((c) => row.appendChild(c));
    return row;
  }

  _textInput(value, placeholder, onChange, widthCss) {
    const input = document.createElement("input");
    input.type = "text";
    input.value = value || "";
    input.placeholder = placeholder || "";
    if (widthCss) input.style.width = widthCss;
    else input.style.flex = "1";
    input.addEventListener("change", (ev) => onChange(ev.target.value));
    return input;
  }

  _removeBtn(onClick) {
    const btn = document.createElement("button");
    btn.className = "fpp-remove";
    btn.type = "button";
    btn.title = "Ta bort";
    btn.textContent = "✕";
    btn.addEventListener("click", onClick);
    return btn;
  }

  _addBtn(label, onClick) {
    const btn = document.createElement("button");
    btn.className = "fpp-add";
    btn.type = "button";
    btn.textContent = label;
    btn.addEventListener("click", onClick);
    return btn;
  }

  _colorInput(value, fallback, onChange) {
    const input = document.createElement("input");
    input.type = "color";
    input.value = /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback;
    input.addEventListener("change", (ev) => onChange(ev.target.value));
    return input;
  }

  // Nästlad lista med "idag"-sensorer för en person.
  _personEntitiesList(p, idx) {
    const wrap = document.createElement("div");
    const label = document.createElement("div");
    label.className = "fpp-label";
    label.textContent = "Idag-sensorer (en rad per sensor i Idag-vyn)";
    wrap.appendChild(label);

    (p.entities || []).forEach((eid, eIdx) => {
      const picker = this._mkEntityPicker(eid, (val) => {
        const list = [...(this._data.persons[idx].entities || [])];
        list[eIdx] = val;
        this._data.persons[idx] = { ...this._data.persons[idx], entities: list };
        this._markDirty();
      });
      const removeBtn = this._removeBtn(() => {
        const list = (this._data.persons[idx].entities || []).filter((_, i) => i !== eIdx);
        this._data.persons[idx] = { ...this._data.persons[idx], entities: list };
        this._markDirty();
        this._render();
      });
      wrap.appendChild(this._row([picker, removeBtn]));
    });

    wrap.appendChild(
      this._addBtn("+ Lägg till sensor", () => {
        const list = [...(this._data.persons[idx].entities || []), ""];
        this._data.persons[idx] = { ...this._data.persons[idx], entities: list };
        this._markDirty();
        this._render();
      })
    );
    return wrap;
  }

  // Nästlad lista med ikon-nyckelord (match+ikon+förhandsvisning) - delas
  // mellan personers egna nyckelord och den globala listan. Tar en
  // getList()-funktion (inte en statisk array) så varje fälts onChange
  // alltid läser senaste data - annars tappas ändringar om man redigerar
  // två fält i samma rad utan omritning emellan.
  _iconKeywordsList(getList, setList) {
    const wrap = document.createElement("div");
    const keywords = getList();
    keywords.forEach((kw, kIdx) => {
      const matchInput = this._textInput(kw.match, "Ord, t.ex. fotboll", (val) => {
        const list = [...getList()];
        list[kIdx] = { ...list[kIdx], match: val };
        setList(list);
        this._markDirty();
      });
      const iconInput = this._textInput(kw.icon, "⚽ eller mdi:soccer", (val) => {
        const list = [...getList()];
        list[kIdx] = { ...list[kIdx], icon: val };
        setList(list);
        preview.innerHTML = renderKeywordBadge(list[kIdx]);
        this._markDirty();
      }, "130px");
      // Egna fält för bild - kan sättas tillsammans med ikonen ovan (t.ex.
      // en bild i Idag-vyn, men ikonen använd på andra ställen senare).
      // Bilden vinner om båda är satta, se renderKeywordBadge.
      const imageInput = this._textInput(kw.image, "Bild-URL (valfri)", (val) => {
        const list = [...getList()];
        list[kIdx] = { ...list[kIdx], image: val };
        setList(list);
        preview.innerHTML = renderKeywordBadge(list[kIdx]);
        this._markDirty();
      }, "160px");
      const preview = document.createElement("div");
      preview.innerHTML = renderKeywordBadge(kw);
      const removeBtn = this._removeBtn(() => {
        setList(getList().filter((_, i) => i !== kIdx));
        this._markDirty();
        this._render();
      });
      wrap.appendChild(this._row([matchInput, iconInput, imageInput, preview, removeBtn]));
    });
    wrap.appendChild(
      this._addBtn("+ Lägg till nyckelord", () => {
        setList([...getList(), { match: "", icon: "", image: "" }]);
        this._markDirty();
        this._render();
      })
    );
    return wrap;
  }

  _personCard(p, idx) {
    const card = document.createElement("div");
    card.className = "fpp-item-card";

    const nameField = document.createElement("div");
    nameField.className = "fpp-field";
    nameField.innerHTML = `<div class="fpp-label">Namn</div>`;
    nameField.appendChild(
      this._textInput(p.name, "Namn", (val) => {
        this._data.persons[idx] = { ...this._data.persons[idx], name: val };
        this._markDirty();
      })
    );

    const personEntityField = document.createElement("div");
    personEntityField.className = "fpp-field";
    personEntityField.innerHTML = `<div class="fpp-label">Koppla till HA-person (valfri - hämtar namn + profilbild)</div>`;
    personEntityField.appendChild(
      this._mkEntityPicker(p.person_entity, (val) => {
        this._data.persons[idx] = { ...this._data.persons[idx], person_entity: val };
        this._markDirty();
      }, "person.namn", ["person"])
    );

    const calField = document.createElement("div");
    calField.className = "fpp-field";
    calField.innerHTML = `<div class="fpp-label">Kalender (används för både veckoschema och månadsvy)</div>`;
    calField.appendChild(
      this._mkEntityPicker(p.calendar_entity, (val) => {
        this._data.persons[idx] = { ...this._data.persons[idx], calendar_entity: val };
        this._markDirty();
      }, null, ["calendar"])
    );

    const removeBtn = this._removeBtn(() => {
      this._data.persons = this._data.persons.filter((_, i) => i !== idx);
      this._markDirty();
      this._render();
    });

    const iconInput = this._textInput(p.icon, "mdi:account", (val) => {
      this._data.persons[idx] = { ...this._data.persons[idx], icon: val };
      this._markDirty();
    });
    const colorInput = this._colorInput(p.color, "#03a9f4", (val) => {
      this._data.persons[idx] = { ...this._data.persons[idx], color: val };
      this._markDirty();
    });

    card.appendChild(this._row([nameField, removeBtn]));
    card.appendChild(this._row([personEntityField]));
    card.appendChild(this._personEntitiesList(p, idx));
    card.appendChild(this._row([calField]));
    card.appendChild(this._row([iconInput, colorInput]));

    const kwLabel = document.createElement("div");
    kwLabel.className = "fpp-label";
    kwLabel.textContent = "Person-specifika ikon-nyckelord (matchar före de globala nedan)";
    card.appendChild(kwLabel);
    card.appendChild(
      this._iconKeywordsList(
        () => this._data.persons[idx].icon_keywords || [],
        (list) => {
          this._data.persons[idx] = { ...this._data.persons[idx], icon_keywords: list };
        }
      )
    );

    return card;
  }

  _calendarCard(c, idx) {
    const card = document.createElement("div");
    card.className = "fpp-item-card";

    const entityField = document.createElement("div");
    entityField.className = "fpp-field";
    entityField.innerHTML = `<div class="fpp-label">Kalender-entitet</div>`;
    entityField.appendChild(
      this._mkEntityPicker(c.entity, (val) => {
        this._data.calendars[idx] = { ...this._data.calendars[idx], entity: val };
        this._markDirty();
      }, "calendar.familj", ["calendar"])
    );

    const nameInput = this._textInput(c.name, "Namn", (val) => {
      this._data.calendars[idx] = { ...this._data.calendars[idx], name: val };
      this._markDirty();
    }, "160px");

    const colorInput = this._colorInput(c.color, "#95a5a6", (val) => {
      this._data.calendars[idx] = { ...this._data.calendars[idx], color: val };
      this._markDirty();
    });

    const removeBtn = this._removeBtn(() => {
      this._data.calendars = this._data.calendars.filter((_, i) => i !== idx);
      this._markDirty();
      this._render();
    });

    card.appendChild(this._row([entityField]));
    card.appendChild(this._row([nameInput, colorInput, removeBtn]));
    return card;
  }

  // En kalender som visar när 1+ barn är hos sin andra förälder - matchar
  // mot cfg.persons via personMatchKey(), inte index, så den håller sig
  // rätt även om personlistan ordnas om. Används av kortet för att gråa
  // ut barnet i Idag-vyn och färglägga dagar i månadsvyn.
  _awayCalendarCard(a, idx) {
    const card = document.createElement("div");
    card.className = "fpp-item-card";

    const entityField = document.createElement("div");
    entityField.className = "fpp-field";
    entityField.innerHTML = `<div class="fpp-label">Kalender-entitet</div>`;
    entityField.appendChild(
      this._mkEntityPicker(a.entity, (val) => {
        this._data.away_calendars[idx] = { ...this._data.away_calendars[idx], entity: val };
        this._markDirty();
      }, "calendar.hos_pappa", ["calendar"])
    );

    const nameInput = this._textInput(a.name, "Text, t.ex. Hos pappa", (val) => {
      this._data.away_calendars[idx] = { ...this._data.away_calendars[idx], name: val };
      this._markDirty();
    }, "160px");

    const colorInput = this._colorInput(a.color, "#95a5a6", (val) => {
      this._data.away_calendars[idx] = { ...this._data.away_calendars[idx], color: val };
      this._markDirty();
    });

    const removeBtn = this._removeBtn(() => {
      this._data.away_calendars = this._data.away_calendars.filter((_, i) => i !== idx);
      this._markDirty();
      this._render();
    });

    const personsLabel = document.createElement("div");
    personsLabel.className = "fpp-label";
    personsLabel.textContent = "Vilka barn/personer gäller kalendern för";
    const personsWrap = document.createElement("div");
    personsWrap.className = "fpp-away-persons";
    const selected = Array.isArray(a.persons) ? a.persons : [];
    if (this._data.persons.length === 0) {
      const empty = document.createElement("span");
      empty.className = "fpp-label";
      empty.textContent = "Lägg till en person ovan först.";
      personsWrap.appendChild(empty);
    }
    this._data.persons.forEach((p) => {
      const key = personMatchKey(p);
      const label = document.createElement("label");
      label.className = "fpp-away-person-chip";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = !!key && selected.includes(key);
      checkbox.disabled = !key;
      checkbox.addEventListener("change", (ev) => {
        // Läser this._data.away_calendars[idx].persons på nytt istället för
        // att stänga över "selected" - annars tappas den första kryssningen
        // om man kryssar två barn i samma kort utan omritning emellan.
        const current = Array.isArray(this._data.away_calendars[idx].persons)
          ? this._data.away_calendars[idx].persons
          : [];
        const list = ev.target.checked ? [...current, key] : current.filter((k) => k !== key);
        this._data.away_calendars[idx] = { ...this._data.away_calendars[idx], persons: list };
        this._markDirty();
      });
      label.appendChild(checkbox);
      label.appendChild(document.createTextNode(key || "(sätt namn på personen först)"));
      personsWrap.appendChild(label);
    });

    card.appendChild(this._row([entityField]));
    card.appendChild(this._row([nameInput, colorInput, removeBtn]));
    card.appendChild(personsLabel);
    card.appendChild(personsWrap);
    return card;
  }

  _countdownCard(item, idx) {
    const card = document.createElement("div");
    card.className = "fpp-item-card";

    const entityField = document.createElement("div");
    entityField.className = "fpp-field";
    entityField.innerHTML = `<div class="fpp-label">Entitet (state = datum, om inget attribut anges nedan)</div>`;
    entityField.appendChild(
      this._mkEntityPicker(item.entity, (val) => {
        const items = [...this._data.countdowns.items];
        items[idx] = { ...items[idx], entity: val };
        this._data.countdowns = { ...this._data.countdowns, items };
        this._markDirty();
      })
    );

    const nameInput = this._textInput(item.name, "Namn", (val) => {
      const items = [...this._data.countdowns.items];
      items[idx] = { ...items[idx], name: val };
      this._data.countdowns = { ...this._data.countdowns, items };
      this._markDirty();
    }, "140px");

    const dateAttrField = document.createElement("div");
    dateAttrField.className = "fpp-field";
    dateAttrField.innerHTML = `<div class="fpp-label">Attribut med datum (valfritt - t.ex. next_date. Lämna tomt för att använda state direkt)</div>`;
    dateAttrField.appendChild(
      this._textInput(item.date_attribute, "t.ex. next_date", (val) => {
        const items = [...this._data.countdowns.items];
        items[idx] = { ...items[idx], date_attribute: val };
        this._data.countdowns = { ...this._data.countdowns, items };
        this._markDirty();
      })
    );

    const pinnedLabel = document.createElement("label");
    pinnedLabel.style.display = "flex";
    pinnedLabel.style.alignItems = "center";
    pinnedLabel.style.gap = "4px";
    pinnedLabel.style.fontSize = "0.85em";
    const pinnedCheckbox = document.createElement("input");
    pinnedCheckbox.type = "checkbox";
    pinnedCheckbox.checked = !!item.pinned;
    pinnedCheckbox.addEventListener("change", (ev) => {
      const items = [...this._data.countdowns.items];
      items[idx] = { ...items[idx], pinned: ev.target.checked };
      this._data.countdowns = { ...this._data.countdowns, items };
      this._markDirty();
    });
    pinnedLabel.appendChild(pinnedCheckbox);
    pinnedLabel.appendChild(document.createTextNode("Visa alltid"));

    const removeBtn = this._removeBtn(() => {
      const items = this._data.countdowns.items.filter((_, i) => i !== idx);
      this._data.countdowns = { ...this._data.countdowns, items };
      this._markDirty();
      this._render();
    });

    card.appendChild(this._row([entityField, nameInput, pinnedLabel, removeBtn]));
    card.appendChild(this._row([dateAttrField]));
    return card;
  }

  _vacationCard(kw, idx) {
    const card = document.createElement("div");
    card.className = "fpp-item-card";

    const matchInput = this._textInput(kw.match, "Ord att matcha, t.ex. lov", (val) => {
      const vacation_keywords = [...this._data.vacation_keywords];
      vacation_keywords[idx] = { ...vacation_keywords[idx], match: val };
      this._data.vacation_keywords = vacation_keywords;
      this._markDirty();
    });

    const colorInput = this._colorInput(kw.color, "#c8f7c5", (val) => {
      const vacation_keywords = [...this._data.vacation_keywords];
      vacation_keywords[idx] = { ...vacation_keywords[idx], color: val };
      this._data.vacation_keywords = vacation_keywords;
      this._markDirty();
    });

    const removeBtn = this._removeBtn(() => {
      this._data.vacation_keywords = this._data.vacation_keywords.filter((_, i) => i !== idx);
      this._markDirty();
      this._render();
    });

    card.appendChild(this._row([matchInput, colorInput, removeBtn]));
    return card;
  }

  _generalCard(g, idx) {
    const card = document.createElement("div");
    card.className = "fpp-item-card";

    const entityField = document.createElement("div");
    entityField.className = "fpp-field";
    entityField.innerHTML = `<div class="fpp-label">Entitet (binary_sensor)</div>`;
    entityField.appendChild(
      this._mkEntityPicker(g.entity, (val) => {
        const general = [...this._data.general];
        general[idx] = { ...general[idx], entity: val };
        this._data.general = general;
        this._markDirty();
      }, null, ["binary_sensor"])
    );

    const nameInput = this._textInput(g.name, "Namn", (val) => {
      const general = [...this._data.general];
      general[idx] = { ...general[idx], name: val };
      this._data.general = general;
      this._markDirty();
    }, "120px");

    const iconInput = this._textInput(g.icon, "mdi:bell", (val) => {
      const general = [...this._data.general];
      general[idx] = { ...general[idx], icon: val };
      this._data.general = general;
      this._markDirty();
    }, "120px");

    const removeBtn = this._removeBtn(() => {
      this._data.general = this._data.general.filter((_, i) => i !== idx);
      this._markDirty();
      this._render();
    });

    card.appendChild(this._row([entityField]));
    card.appendChild(this._row([nameInput, iconInput, removeBtn]));
    return card;
  }

  _render() {
    const narrowDisplay = this._narrow ? "" : "none";
    this.innerHTML = `
      <style>
        :host, .fpp-root { display: block; height: 100%; box-sizing: border-box; }
        .fpp-root {
          background: var(--primary-background-color);
          color: var(--primary-text-color);
          min-height: 100vh;
        }
        .fpp-header {
          display: flex; align-items: center; gap: 12px;
          padding: 0 16px; height: 64px;
          background: var(--app-header-background-color, var(--primary-color));
          color: var(--app-header-text-color, white);
        }
        .fpp-header-title { font-size: 1.25em; font-weight: 500; flex: 1; }
        #fpp-menu-btn {
          display: ${narrowDisplay}; background: none; border: none; color: inherit;
          font-size: 1.4em; cursor: pointer; padding: 8px;
        }
        #fpp-status { font-size: 0.85em; opacity: 0.85; margin-right: 4px; }
        #fpp-save-btn {
          background: white; color: var(--primary-color); border: none;
          border-radius: 18px; padding: 8px 18px; font-size: 0.9em; font-weight: 500;
          cursor: pointer;
        }
        #fpp-save-btn:disabled { opacity: 0.6; cursor: default; }
        .fpp-content { max-width: 760px; margin: 0 auto; padding: 20px 16px 60px 16px; }
        .fpp-section {
          margin-bottom: 24px; padding-bottom: 18px;
          border-bottom: 1px solid var(--divider-color);
        }
        .fpp-section:last-child { border-bottom: none; }
        .fpp-section-title { font-weight: 500; margin-bottom: 12px; font-size: 1.1em; }
        .fpp-section-hint { color: var(--secondary-text-color); font-size: 0.85em; margin-bottom: 12px; }
        .fpp-row { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
        .fpp-row input[type="text"], .fpp-row input[type="number"] {
          padding: 8px; border: 1px solid var(--divider-color); border-radius: 6px;
          background: var(--card-background-color); color: var(--primary-text-color); font-size: 0.9em;
        }
        .fpp-row input[type="color"] { width: 36px; height: 36px; padding: 2px; }
        .fpp-checkbox-row { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
        .fpp-subtitle { font-weight: 500; margin: 16px 0 10px; font-size: 0.95em; }
        .fpp-subtitle:first-child { margin-top: 0; }
        .fpp-item-card {
          border: 1px solid var(--divider-color); border-radius: 10px;
          padding: 14px; margin-bottom: 14px; background: var(--card-background-color);
        }
        .fpp-remove {
          border: none; background: none; color: var(--error-color, #db4437);
          cursor: pointer; font-size: 1.1em; padding: 4px 8px;
        }
        .fpp-add {
          border: 1px dashed var(--primary-color); background: none; color: var(--primary-color);
          border-radius: 6px; padding: 9px 12px; cursor: pointer; font-size: 0.9em; width: 100%;
        }
        .fpp-label { font-size: 0.8em; color: var(--secondary-text-color); margin-bottom: 3px; margin-top: 6px; }
        .fpp-field { display: flex; flex-direction: column; flex: 1; }
        .fpp-kw-icon { --mdc-icon-size: 18px; }
        .fpp-kw-image { width: 18px; height: 18px; border-radius: 50%; object-fit: cover; }
        .fpp-empty { color: var(--secondary-text-color); font-style: italic; margin-bottom: 12px; }
        .fpp-away-persons { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 4px; }
        .fpp-away-person-chip {
          display: flex; align-items: center; gap: 6px; font-size: 0.85em;
          border: 1px solid var(--divider-color); border-radius: 16px; padding: 5px 10px;
        }
      </style>
      <div class="fpp-root">
        <div class="fpp-header">
          <button id="fpp-menu-btn">☰</button>
          <div class="fpp-header-title">Familjeplanering</div>
          <div id="fpp-status"></div>
          <button id="fpp-save-btn">Spara</button>
        </div>
        <div class="fpp-content">
          <div class="fpp-section">
            <div class="fpp-section-title">Allmänt</div>
            <div class="fpp-section-hint">
              Gäller alla Family Planner-kort på den här HA-instansen.
            </div>
            <div class="fpp-row" id="fpp-title-row"></div>
            <div class="fpp-checkbox-row" id="fpp-collapsed-row"></div>
          </div>
          <div class="fpp-section">
            <div class="fpp-section-title">Nedräkningar</div>
            <div class="fpp-row" id="fpp-maxshown-row"></div>
            <div id="fpp-countdown-list"></div>
          </div>
          <div class="fpp-section">
            <div class="fpp-section-title">Väder</div>
            <div class="fpp-row" id="fpp-weather-entity-row"></div>
            <div class="fpp-checkbox-row" id="fpp-weather-week-row"></div>
          </div>
          <div class="fpp-section">
            <div class="fpp-section-title">Personer</div>
            <div class="fpp-section-hint">
              Dessa personer, kalendrar och sensorer hämtas automatiskt av alla
              Family Planner-kort.
            </div>
            <div id="fpp-person-list"></div>
          </div>
          <div class="fpp-section">
            <div class="fpp-section-title">Delade kalendrar (hör inte till en specifik person)</div>
            <div class="fpp-row" id="fpp-calendars-label-row"></div>
            <div id="fpp-calendar-list"></div>
          </div>
          <div class="fpp-section">
            <div class="fpp-section-title">Borta hos andra föräldern</div>
            <div class="fpp-section-hint">
              Kalendrar som visar när ett barn är hos sin andra förälder. Barnet
              tonas ner i Idag-vyn medan de är borta, och dagarna färgas i
              månadskalendern (delat i fält om flera barn är borta med olika
              kalendrar samma dag).
            </div>
            <div id="fpp-away-list"></div>
          </div>
          <div class="fpp-section">
            <div class="fpp-section-title">Globala ikon-nyckelord</div>
            <div class="fpp-section-hint">
              Matchar ord i händelser/sensortexter mot en emoji, mdi-ikon eller
              bild - gäller alla personer som inte har en egen matchning för
              samma ord.
            </div>
            <div id="fpp-keyword-list"></div>
          </div>
          <div class="fpp-section">
            <div class="fpp-section-title">Månadskalender</div>
            <div class="fpp-checkbox-row" id="fpp-monthcal-row"></div>
          </div>
          <div class="fpp-section">
            <div class="fpp-section-title">Semestermarkering (färgar hela dagar i månadskalendern)</div>
            <div id="fpp-vacation-list"></div>
          </div>
          <div class="fpp-section">
            <div class="fpp-section-title">Röstuppläsning (TTS)</div>
            <div class="fpp-row" id="fpp-tts-entity-row"></div>
            <div class="fpp-row" id="fpp-tts-player-row"></div>
          </div>
          <div class="fpp-section">
            <div class="fpp-section-title">Allmänna sensorer (visas som rund ikon när "on")</div>
            <div id="fpp-general-list"></div>
          </div>
        </div>
      </div>
    `;

    this.querySelector("#fpp-menu-btn").addEventListener("click", () => this._toggleMenu());
    this.querySelector("#fpp-save-btn").addEventListener("click", () => this._save());
    this._updateStatus();

    // Allmänt
    const titleField = document.createElement("div");
    titleField.className = "fpp-field";
    titleField.innerHTML = `<div class="fpp-label">Titel</div>`;
    titleField.appendChild(
      this._textInput(this._data.title, "Familjeplanering", (val) => {
        this._data.title = val;
        this._markDirty();
      })
    );
    this.querySelector("#fpp-title-row").appendChild(titleField);

    const collapsedRow = this.querySelector("#fpp-collapsed-row");
    const collapsedCheckbox = document.createElement("input");
    collapsedCheckbox.type = "checkbox";
    collapsedCheckbox.checked = this._data.start_collapsed;
    collapsedCheckbox.addEventListener("change", (ev) => {
      this._data.start_collapsed = ev.target.checked;
      this._markDirty();
    });
    const collapsedLabel = document.createElement("label");
    collapsedLabel.textContent = 'Starta "Idag"-sektionen ihopfälld';
    collapsedRow.appendChild(collapsedCheckbox);
    collapsedRow.appendChild(collapsedLabel);

    // Nedräkningar
    const maxField = document.createElement("div");
    maxField.className = "fpp-field";
    maxField.innerHTML = `<div class="fpp-label">Hur många nedräkningar som visas normalt</div>`;
    const maxInput = document.createElement("input");
    maxInput.type = "number";
    maxInput.min = "0";
    maxInput.value = this._data.countdowns.max_shown;
    maxInput.style.width = "80px";
    maxInput.addEventListener("change", (ev) => {
      const n = parseInt(ev.target.value, 10);
      this._data.countdowns = { ...this._data.countdowns, max_shown: isNaN(n) ? 5 : n };
      this._markDirty();
    });
    maxField.appendChild(maxInput);
    this.querySelector("#fpp-maxshown-row").appendChild(maxField);

    const cdListEl = this.querySelector("#fpp-countdown-list");
    this._data.countdowns.items.forEach((item, idx) => cdListEl.appendChild(this._countdownCard(item, idx)));
    cdListEl.appendChild(
      this._addBtn("+ Lägg till nedräkning", () => {
        this._data.countdowns = {
          ...this._data.countdowns,
          items: [...this._data.countdowns.items, { entity: "", name: "", pinned: false }],
        };
        this._markDirty();
        this._render();
      })
    );

    // Väder
    const weatherEntityField = document.createElement("div");
    weatherEntityField.className = "fpp-field";
    weatherEntityField.innerHTML = `<div class="fpp-label">Väder-entitet (weather.*)</div>`;
    weatherEntityField.appendChild(
      this._mkEntityPicker(this._data.weather.entity, (val) => {
        this._data.weather = { ...this._data.weather, entity: val };
        this._markDirty();
      }, null, ["weather"])
    );
    this.querySelector("#fpp-weather-entity-row").appendChild(weatherEntityField);

    const weatherWeekRowEl = this.querySelector("#fpp-weather-week-row");
    const weatherWeekCheckbox = document.createElement("input");
    weatherWeekCheckbox.type = "checkbox";
    weatherWeekCheckbox.checked = this._data.weather.show_week;
    weatherWeekCheckbox.addEventListener("change", (ev) => {
      this._data.weather = { ...this._data.weather, show_week: ev.target.checked };
      this._markDirty();
    });
    const weatherWeekLabel = document.createElement("label");
    weatherWeekLabel.textContent = "Visa väderprognos för veckans dagar";
    weatherWeekRowEl.appendChild(weatherWeekCheckbox);
    weatherWeekRowEl.appendChild(weatherWeekLabel);

    const personListEl = this.querySelector("#fpp-person-list");
    if (this._data.persons.length === 0) {
      const empty = document.createElement("div");
      empty.className = "fpp-empty";
      empty.textContent = "Inga personer ännu.";
      personListEl.appendChild(empty);
    }
    this._data.persons.forEach((p, idx) => personListEl.appendChild(this._personCard(p, idx)));
    personListEl.appendChild(
      this._addBtn("+ Lägg till person", () => {
        this._data.persons = [...this._data.persons, { name: "", entities: [], icon_keywords: [] }];
        this._markDirty();
        this._render();
      })
    );

    const calLabelField = document.createElement("div");
    calLabelField.className = "fpp-field";
    calLabelField.innerHTML = `<div class="fpp-label">Radnamn i veckoschemat</div>`;
    calLabelField.appendChild(
      this._textInput(this._data.calendars_label, "Övrigt", (val) => {
        this._data.calendars_label = val;
        this._markDirty();
      })
    );
    this.querySelector("#fpp-calendars-label-row").appendChild(calLabelField);

    const calListEl = this.querySelector("#fpp-calendar-list");
    this._data.calendars.forEach((c, idx) => calListEl.appendChild(this._calendarCard(c, idx)));
    calListEl.appendChild(
      this._addBtn("+ Lägg till kalender", () => {
        this._data.calendars = [...this._data.calendars, { entity: "", name: "", color: "#95a5a6" }];
        this._markDirty();
        this._render();
      })
    );

    const awayListEl = this.querySelector("#fpp-away-list");
    this._data.away_calendars.forEach((a, idx) => awayListEl.appendChild(this._awayCalendarCard(a, idx)));
    awayListEl.appendChild(
      this._addBtn("+ Lägg till borta-kalender", () => {
        this._data.away_calendars = [
          ...this._data.away_calendars,
          { entity: "", name: "", color: "#95a5a6", persons: [] },
        ];
        this._markDirty();
        this._render();
      })
    );

    const kwListEl = this.querySelector("#fpp-keyword-list");
    kwListEl.appendChild(
      this._iconKeywordsList(
        () => this._data.icon_keywords || [],
        (list) => {
          this._data.icon_keywords = list;
        }
      )
    );

    // Månadskalender - visa/dölj
    const monthCalRow = this.querySelector("#fpp-monthcal-row");
    const monthCalCheckbox = document.createElement("input");
    monthCalCheckbox.type = "checkbox";
    monthCalCheckbox.checked = this._data.show_month_calendar;
    monthCalCheckbox.addEventListener("change", (ev) => {
      this._data.show_month_calendar = ev.target.checked;
      this._markDirty();
    });
    const monthCalLabel = document.createElement("label");
    monthCalLabel.textContent = "Visa månadskalender under veckoschemat";
    monthCalRow.appendChild(monthCalCheckbox);
    monthCalRow.appendChild(monthCalLabel);

    // Semestermarkering
    const vacListEl = this.querySelector("#fpp-vacation-list");
    this._data.vacation_keywords.forEach((kw, idx) => vacListEl.appendChild(this._vacationCard(kw, idx)));
    vacListEl.appendChild(
      this._addBtn("+ Lägg till semestermarkering", () => {
        this._data.vacation_keywords = [...this._data.vacation_keywords, { match: "", color: "#c8f7c5" }];
        this._markDirty();
        this._render();
      })
    );

    // TTS
    const ttsEntityField = document.createElement("div");
    ttsEntityField.className = "fpp-field";
    ttsEntityField.innerHTML = `<div class="fpp-label">TTS-entitet (tts.*)</div>`;
    ttsEntityField.appendChild(
      this._mkEntityPicker(this._data.tts.tts_entity, (val) => {
        this._data.tts = { ...this._data.tts, tts_entity: val };
        this._markDirty();
      }, null, ["tts"])
    );
    this.querySelector("#fpp-tts-entity-row").appendChild(ttsEntityField);

    const ttsPlayerField = document.createElement("div");
    ttsPlayerField.className = "fpp-field";
    ttsPlayerField.innerHTML = `<div class="fpp-label">Högtalare (media_player.*)</div>`;
    ttsPlayerField.appendChild(
      this._mkEntityPicker(this._data.tts.media_player, (val) => {
        this._data.tts = { ...this._data.tts, media_player: val };
        this._markDirty();
      }, null, ["media_player"])
    );
    this.querySelector("#fpp-tts-player-row").appendChild(ttsPlayerField);

    // Allmänna sensorer
    const generalListEl = this.querySelector("#fpp-general-list");
    this._data.general.forEach((g, idx) => generalListEl.appendChild(this._generalCard(g, idx)));
    generalListEl.appendChild(
      this._addBtn("+ Lägg till allmän sensor", () => {
        this._data.general = [...this._data.general, { entity: "", name: "", icon: "" }];
        this._markDirty();
        this._render();
      })
    );
  }
}

customElements.define("family-planner-panel", FamilyPlannerPanel);
