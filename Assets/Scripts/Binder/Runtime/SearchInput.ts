// Binder — typing a search, using the system keyboard. Lens runtime.
//
// Snap OS owns the keyboard: a Lens asks for it and receives text back through
// callbacks. There is no in-world key grid to build, and building one would be
// worse — the system keyboard follows the user's hands and gaze properly.
//
// NOTE the keyboard does not appear in Lens Studio Preview. On desktop this
// opens, reports nothing, and closes; it only really runs on the device.

const TAG = '[Binder][search]';

export class SearchInput {
  private open = false;
  private text = '';
  private onChange: (text: string) => void = () => {};
  private onCommit: (text: string) => void = () => {};

  isOpen(): boolean { return this.open; }

  /**
   * Ask for the keyboard. `change` fires on every keystroke so the panel can
   * echo what is being typed; `commit` fires once, when the user is done.
   */
  request(
    initial: string,
    change: (text: string) => void,
    commit: (text: string) => void,
  ): void {
    const system = global.textInputSystem;
    if (system === undefined || system === null) {
      console.warn(`${TAG} no text input system on this platform`);
      commit('');
      return;
    }

    this.text = initial;
    this.onChange = change;
    this.onCommit = commit;

    const options = new TextInputSystem.KeyboardOptions();
    options.initialText = initial;
    options.keyboardType = TextInputSystem.KeyboardType.Text;
    // "Search", not "Done": the return key should say what it will do.
    options.returnKeyType = TextInputSystem.ReturnKeyType.Search;

    options.onTextChanged = (text: string) => {
      this.text = text;
      this.onChange(text);
    };
    // Snap OS delivers edits through this richer callback; keep both so the
    // Lens works whichever one the platform drives.
    options.onUpdateText = (update: TextInputSystem.TextUpdate) => {
      this.text = update.text;
      this.onChange(update.text);
    };
    options.onReturnKeyPressed = () => this.finish();
    options.onKeyboardStateChanged = (isOpen: boolean) => {
      // Closing the keyboard by any route still means "run what I typed",
      // otherwise a dismissed keyboard silently discards the search.
      if (!isOpen && this.open) this.finish();
    };

    this.open = true;
    system.requestKeyboard(options);
  }

  /** Close the keyboard and hand back the final text. */
  finish(): void {
    if (!this.open) return;
    this.open = false;
    const system = global.textInputSystem;
    if (system !== undefined && system !== null) system.dismissKeyboard();
    const text = this.text.trim();
    this.text = '';
    this.onCommit(text);
  }
}
