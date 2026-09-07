// Binder — the main menu, built on SpectaclesUIKit. Lens runtime.
//
// The Lens used to open straight into deck building, which assumed the only
// reason to put it on. Three doors instead.
//
// Built from UIKit primitives rather than hand-placed quads: a BackPlate for
// the surface, a FlexLayout column for the stack, and a real Button per row so
// hover and press states come from the kit instead of being re-invented badly.

import { Button } from 'SpectaclesUIKit.lspkg/Scripts/Components/Button/Button';
import { FlexAlign, FlexJustify } from 'SpectaclesUIKit.lspkg/Scripts/Components/Layout2D/Flex/FlexTypes';
import type { AppMode } from '../Core/Modes';
import { MENU_ITEMS, SHARE_ITEM } from '../Core/Modes';
import { RIOT_LEGAL_NOTICE, PROJECT_TITLE } from '../Core/Attribution';
import {
  makeCanvas, makeBackPlate, makeColumn, makeObject, makeText, addChild,
  addButtonRim, tintButtonFill, feelPress,
  addColumnText, CONTENT_Z, BUTTON_LABEL_Z,
} from './UIKitUtils';

const ROW_HEIGHT_CM = 12;
const ROW_GAP_CM = 2.4;
const PAD_X_CM = 5;
const PAD_Y_CM = 4;
const ATTRIBUTION_HEIGHT_CM = 9;

export class MainMenuView {
  private onChoose: (mode: AppMode) => void = () => {};
  private onShareChosen: () => void = () => {};

  constructor(
    root: SceneObject,
    _mesh: RenderMesh,
    _materialTemplate: Material,
    private readonly font: Font | null,
    widthCm: number,
    heightCm: number,
  ) {
    makeCanvas(root);
    // Surface first: the Canvas paints depth-first, so the plate drawn before
    // the content is the plate drawn behind it.
    makeBackPlate(root, widthCm, heightCm);

    const content = makeObject(root, 'Content', new vec3(0, 0, CONTENT_Z));
    const column = makeColumn(content, widthCm, heightCm, {
      gap: ROW_GAP_CM,
      padX: PAD_X_CM,
      padY: PAD_Y_CM,
      justify: FlexJustify.Start,
      align: FlexAlign.Stretch,
    });

    addColumnText(column, this.font, 'Menu Title', PROJECT_TITLE, 10, { role: 'Title1' });

    const rowWidth = widthCm - PAD_X_CM * 2;
    for (const item of MENU_ITEMS) {
      this.buildRow(column, item.label, item.blurb, rowWidth, () => this.onChoose(item.mode));
    }
    this.buildRow(column, SHARE_ITEM.label, SHARE_ITEM.blurb, rowWidth,
      () => this.onShareChosen());

    // Riot's policy requires this notice somewhere "clear and easy to find".
    // The home screen is exactly that, and fine print at the foot of it is not
    // in the way of building a deck — which is why it is here rather than
    // floating below every panel, where it used to be.
    addColumnText(column, this.font, 'Attribution', RIOT_LEGAL_NOTICE, ATTRIBUTION_HEIGHT_CM, {
      role: 'Caption', tone: 'tertiary', widthCm: rowWidth, wrap: true,
    });
  }

  onSelect(handler: (mode: AppMode) => void): void { this.onChoose = handler; }

  onShare(handler: () => void): void { this.onShareChosen = handler; }

  /** UIKit animates its own hover and press states, so there is nothing to step. */
  advance(_deltaSeconds: number): void {}

  private buildRow(
    column: SceneObject, label: string, blurb: string, widthCm: number, onPress: () => void,
  ): void {
    addChild(column, { w: widthCm, h: ROW_HEIGHT_CM }, (cell) => {
      const button = cell.createComponent(Button.getTypeName()) as Button;
      button.size = new vec3(widthCm, ROW_HEIGHT_CM, 1);
      addButtonRim(cell, widthCm, ROW_HEIGHT_CM);
      tintButtonFill(button);
      feelPress(button, cell);

      // Two lines on one face: what the screen is, and what it is for. Both are
      // lifted off the button face so their leading glyphs are not clipped.
      const labelRow = makeObject(cell, 'Label', new vec3(0, 2.2, BUTTON_LABEL_Z));
      makeText(labelRow, this.font, 'Text', label, {
        role: 'Headline2', widthCm: widthCm - 2, heightCm: 5,
      });

      const blurbRow = makeObject(cell, 'Blurb', new vec3(0, -3.0, BUTTON_LABEL_Z));
      makeText(blurbRow, this.font, 'Text', blurb, {
        role: 'Caption', tone: 'secondary', widthCm: widthCm - 2, heightCm: 4,
      });

      button.onTriggerUp.add(() => onPress());
    });
  }
}
