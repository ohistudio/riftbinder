// Binder — SpectaclesUIKit composition helpers. Lens runtime.
//
// The panels used to be hand-built plates: a quad, a colour, and hand-computed
// child offsets. UIKit gives the real thing — rounded surfaces with proper
// edges, buttons with built-in press and hover states, and CSS-style flex
// layout instead of arithmetic. These are the helpers the UI skill prescribes,
// kept in one place so every panel composes the same way.

import { BackPlate } from 'SpectaclesUIKit.lspkg/Scripts/BackPlate';
import { makeBorder } from './PanelBorder';
import { uiColor } from './ViewUtils';
import { Config } from '../Core/Config';
import type { RoundedRectangle } from 'SpectaclesUIKit.lspkg/Scripts/Visuals/RoundedRectangle/RoundedRectangle';
import { Billboard } from 'SpectaclesInteractionKit.lspkg/Components/Interaction/Billboard/Billboard';
import { Button } from 'SpectaclesUIKit.lspkg/Scripts/Components/Button/Button';
import { FlexLayout } from 'SpectaclesUIKit.lspkg/Scripts/Components/Layout2D/Flex/FlexLayout';
import { FlexItem } from 'SpectaclesUIKit.lspkg/Scripts/Components/Layout2D/Flex/FlexItem';
import {
  FlexAlign, FlexAlignSelf, FlexDirection, FlexJustify,
} from 'SpectaclesUIKit.lspkg/Scripts/Components/Layout2D/Flex/FlexTypes';
import type { TextRole } from '../Core/Typography';
import { roleSize, roleWeight, TEXT_PRIMARY, TEXT_SECONDARY, TEXT_TERTIARY } from '../Core/Typography';

/** Content sits forward of its surface, or it z-fights the plate's front face. */
export const CONTENT_Z = 0.6;
/** A label ON a button face needs its own lift or the leading glyph is clipped. */
export const BUTTON_LABEL_Z = 0.08;

export interface TextOptions {
  role?: TextRole;
  distanceCm?: number;
  tone?: 'primary' | 'secondary' | 'tertiary';
  /** Width of the text's own cell, cm. Size it to the longest expected string. */
  widthCm?: number;
  heightCm?: number;
  wrap?: boolean;
  /** Shrink long text to fit its box instead of spilling out of it. */
  shrink?: boolean;
}

export function makeObject(parent: SceneObject, name: string, position?: vec3): SceneObject {
  const object = global.scene.createSceneObject(name);
  object.setParent(parent);
  if (position !== undefined) object.getTransform().setLocalPosition(position);
  return object;
}

/**
 * A Canvas at a panel root. Its default Hierarchy sorting makes depth-first
 * scene order the render order, which is what lets panels layer without anyone
 * hand-picking a renderOrder.
 */
export function makeCanvas(root: SceneObject): void {
  root.createComponent('Component.Canvas');
}

/**
 * Turn a panel to face the user as they move around it.
 *
 * Yaw only: a panel that also pitches and rolls to chase the head tips over
 * when you look down at it, and the cards on it stop reading as cards.
 */
export function makeBillboard(root: SceneObject): Billboard {
  const billboard = root.createComponent(Billboard.getTypeName()) as Billboard;
  billboard.xAxisEnabled = false;
  billboard.yAxisEnabled = true;
  billboard.zAxisEnabled = false;
  return billboard;
}

/**
 * The panel surface. Created before content so the hierarchy paints it behind.
 *
 * UIKit's own three styles are all neutral greys, which is why the panels read
 * as slabs of dark. The gradient below is applied over the top: a deep indigo
 * falling to a lighter blue, cool against the warm card art it holds, and light
 * enough at the top edge to actually register on an additive display.
 */
export function makeBackPlate(root: SceneObject, widthCm: number, heightCm: number): BackPlate {
  const plate = root.createComponent(BackPlate.getTypeName()) as BackPlate;
  plate.onInitialized.add(() => {
    plate.size = new vec2(widthCm, heightCm);
    tint(plate);
  });
  // Built here rather than at each call site: nine panels are created around
  // the app, and a rim that some of them have is worse than none.
  makeBorder(root, BORDER_MATERIAL, widthCm, heightCm);
  return plate;
}

const BORDER_MATERIAL = requireAsset('../../../Binder Tile Material.mat') as Material;

/** Dimmer than the panel rim: a button should read as inside the panel. */
const BUTTON_RIM = new vec4(0.52, 0.64, 0.98, 1);

/**
 * Recolour a BackPlate. Its visual is private, so this reaches through — the
 * public surface offers a style enum of greys and nothing else.
 */
function tint(plate: BackPlate): void {
  const visual = (plate as unknown as { roundedRectangle?: RoundedRectangle }).roundedRectangle;
  if (visual === undefined || visual === null) return;
  visual.gradient = true;
  // Four stops, not two. A straight two-stop fade across a panel this size
  // banded visibly and read as flat grey-blue in the middle; the extra stops
  // let the violet hold through the upper half and fall away quickly at the
  // bottom, which is what makes it look lit from above rather than tinted.
  visual.setBackgroundGradient({
    type: 'Linear',
    start: new vec2(-1.0, 1.2),
    end: new vec2(1.0, -1.2),
    stop0: { enabled: true, color: PANEL_STOP_0, percent: 0 },
    stop1: { enabled: true, color: PANEL_STOP_1, percent: 0.38 },
    stop2: { enabled: true, color: PANEL_STOP_2, percent: 0.72 },
    stop3: { enabled: true, color: PANEL_STOP_3, percent: 1 },
  });
}

// Top-left to bottom-right. Deep violet falling to near-black ink: on an
// additive display the dark end costs nothing to draw and lets the card art in
// front of it carry the colour.
// Kept DARK on purpose. An additive display adds light, so a bright panel is
// an opaque one: the first pass at this gradient was lighter and turned every
// panel into a lavender slab you could not see the room through. The surface
// is stated at the top edge and then gets out of the way, and it is the rim
// that carries the panel's shape.
const PANEL_STOP_0 = new vec4(0.16, 0.13, 0.30, 1);
const PANEL_STOP_1 = new vec4(0.10, 0.09, 0.22, 1);
const PANEL_STOP_2 = new vec4(0.05, 0.06, 0.14, 1);
const PANEL_STOP_3 = new vec4(0.02, 0.03, 0.08, 1);

/** A flex column. Configured inside onInitialized — the setters race otherwise. */
export function makeColumn(
  parent: SceneObject, widthCm: number, heightCm: number,
  opts?: { gap?: number; padX?: number; padY?: number; justify?: FlexJustify; align?: FlexAlign },
): SceneObject {
  return makeFlex(parent, FlexDirection.Column, widthCm, heightCm, opts);
}

export function makeRow(
  parent: SceneObject, widthCm: number, heightCm: number,
  opts?: { gap?: number; padX?: number; padY?: number; justify?: FlexJustify; align?: FlexAlign },
): SceneObject {
  return makeFlex(parent, FlexDirection.Row, widthCm, heightCm, opts);
}

function makeFlex(
  parent: SceneObject, direction: FlexDirection, widthCm: number, heightCm: number,
  opts?: { gap?: number; padX?: number; padY?: number; justify?: FlexJustify; align?: FlexAlign },
): SceneObject {
  const container = makeObject(parent, 'Flex');
  const flex = container.createComponent(FlexLayout.getTypeName()) as FlexLayout;
  const item = container.createComponent(FlexItem.getTypeName()) as FlexItem;
  if (widthCm > 0) item.overrideWidth = widthCm;
  if (heightCm > 0) item.overrideHeight = heightCm;

  flex.onInitialized.add(() => {
    flex.width = widthCm;
    flex.height = heightCm;
    flex.direction = direction;
    if (direction === FlexDirection.Row) flex.columnGap = opts?.gap ?? 0;
    else flex.rowGap = opts?.gap ?? 0;
    flex.paddingTop = opts?.padY ?? 0;
    flex.paddingBottom = opts?.padY ?? 0;
    flex.paddingLeft = opts?.padX ?? 0;
    flex.paddingRight = opts?.padX ?? 0;
    flex.justifyContent = opts?.justify ?? FlexJustify.Start;
    flex.alignItems = opts?.align ?? FlexAlign.Stretch;
  });
  return container;
}

/**
 * Register a child with its flex parent.
 *
 * A layout with autoDiscoverItemsOnStart (the default) finds children built
 * before it initialises, and THROWS if you call addItems in that window. So
 * register only once it is running; up to then, discovery does the work.
 */
export function addChild(
  parent: SceneObject, size: { w?: number; h?: number; grow?: number },
  build: (child: SceneObject) => void,
): SceneObject {
  const child = makeObject(parent, 'Item');
  const item = child.createComponent(FlexItem.getTypeName()) as FlexItem;
  if (size.w !== undefined && size.w > 0) item.overrideWidth = size.w;
  if (size.h !== undefined && size.h > 0) item.overrideHeight = size.h;
  item.flexGrow = size.grow ?? 0;
  item.flexShrink = 0;

  build(child);

  registerItem(parent, item);
  return child;
}

/**
 * Hand a child to its flex parent, but only when that is safe: before the
 * layout initialises, auto-discovery owns the list and addItems throws.
 */
function registerItem(parent: SceneObject, item: FlexItem): void {
  const flex = parent.getComponent(FlexLayout.getTypeName()) as FlexLayout | null;
  if (flex === null) return;
  const started = (flex as unknown as { _initialized?: boolean })._initialized === true;
  if (!flex.autoDiscoverItemsOnStart || started) flex.addItems([item]);
}

/** Text styled from the type scale. Never set a raw size at the call site. */
export function makeText(
  parent: SceneObject, font: Font | null, name: string, value: string,
  opts: TextOptions = {},
): Text {
  const object = makeObject(parent, name);
  const text = object.createComponent('Component.Text') as Text;
  if (font !== null) text.font = font;
  text.text = value;
  text.depthTest = true;

  const role = opts.role ?? 'Body';
  text.size = roleSize(role, opts.distanceCm);
  (text as Text & { weight?: number }).weight = roleWeight(role);

  const tone = opts.tone ?? 'primary';
  const rgba = tone === 'secondary' ? TEXT_SECONDARY
    : tone === 'tertiary' ? TEXT_TERTIARY : TEXT_PRIMARY;
  text.textFill.color = new vec4(rgba.r, rgba.g, rgba.b, rgba.a);

  text.horizontalAlignment = HorizontalAlignment.Center;
  text.verticalAlignment = VerticalAlignment.Center;
  text.horizontalOverflow = opts.wrap === true ? HorizontalOverflow.Wrap
    : opts.shrink === true ? HorizontalOverflow.Shrink
    : HorizontalOverflow.Overflow;
  text.verticalOverflow = opts.shrink === true
    ? VerticalOverflow.Shrink : VerticalOverflow.Overflow;

  const w = opts.widthCm ?? 1;
  const h = opts.heightCm ?? 2.4;
  text.layoutRect = Rect.create(-w / 2, w / 2, -h / 2, h / 2);
  return text;
}

/**
 * Text as a stretched row of a flex COLUMN. Stretch fills the cross axis, which
 * is the width here, so centred text actually centres. Do not use inside a row.
 */
export function addColumnText(
  parent: SceneObject, font: Font | null, name: string, value: string,
  heightCm: number, opts: TextOptions = {},
): Text {
  const object = makeObject(parent, name);
  const text = makeTextOn(object, font, value, opts);
  const item = object.createComponent(FlexItem.getTypeName()) as FlexItem;
  item.alignSelf = FlexAlignSelf.Stretch;
  item.overrideHeight = heightCm;

  registerItem(parent, item);
  return text;
}

function makeTextOn(object: SceneObject, font: Font | null, value: string, opts: TextOptions): Text {
  const text = object.createComponent('Component.Text') as Text;
  if (font !== null) text.font = font;
  text.text = value;
  text.depthTest = true;
  const role = opts.role ?? 'Body';
  text.size = roleSize(role, opts.distanceCm);
  (text as Text & { weight?: number }).weight = roleWeight(role);
  const tone = opts.tone ?? 'primary';
  const rgba = tone === 'secondary' ? TEXT_SECONDARY
    : tone === 'tertiary' ? TEXT_TERTIARY : TEXT_PRIMARY;
  text.textFill.color = new vec4(rgba.r, rgba.g, rgba.b, rgba.a);
  text.horizontalAlignment = HorizontalAlignment.Center;
  text.verticalAlignment = VerticalAlignment.Center;
  text.horizontalOverflow = opts.wrap === true ? HorizontalOverflow.Wrap
    : opts.shrink === true ? HorizontalOverflow.Shrink
    : HorizontalOverflow.Overflow;
  text.verticalOverflow = opts.shrink === true
    ? VerticalOverflow.Shrink : VerticalOverflow.Overflow;
  const w = opts.widthCm ?? 1;
  const h = opts.heightCm ?? 2.4;
  text.layoutRect = Rect.create(-w / 2, w / 2, -h / 2, h / 2);
  return text;
}

/**
 * Outline a button so it reads as pressable.
 *
 * Exported because three views build their `Button` directly rather than going
 * through makeButton, and a rim on only some of them is worse than none.
 */
export function addButtonRim(object: SceneObject, widthCm: number, heightCm: number): void {
  makeBorder(object, BORDER_MATERIAL, widthCm, heightCm, {
    radiusCm: 1.2, thicknessCm: 0.22, zCm: 0.05, tint: BUTTON_RIM,
  });
}

/**
 * A rim of any size and corner radius, in the panel colour. For the few
 * surfaces that are not UIKit plates or buttons but should still match them.
 */
export function addRim(
  object: SceneObject, widthCm: number, heightCm: number, radiusCm: number, zCm = 0.05,
): void {
  makeBorder(object, BORDER_MATERIAL, widthCm, heightCm, {
    radiusCm, thicknessCm: 0.3, zCm, tint: BUTTON_RIM,
  });
}

/**
 * What every button does when pressed, beyond its own job.
 *
 * Registered once by the app and fired from every button-building site, so
 * a press sounds and feels the same on the menu, the controls bar, the scan
 * panel and the assistant. Before this only ONE press in the whole app made a
 * sound; the rest were silent, which on an additive display — where a button
 * has no physical travel to feel — left you unsure anything had happened.
 */
let onAnyButtonPress: ((object: SceneObject) => void) | null = null;

export function setButtonPressFeedback(handler: (object: SceneObject) => void): void {
  onAnyButtonPress = handler;
}

/** Wire a button's press to the shared feedback. Idempotent per button. */
export function feelPress(button: Button, object: SceneObject): void {
  button.onTriggerDown.add(() => {
    if (onAnyButtonPress !== null) onAnyButtonPress(object);
  });
}

/**
 * Give a button's FACE a colour, not just an edge.
 *
 * `baseDefaultColor` and friends are UIKit's supported way in: they write the
 * visual's own per-state colour map, so unlike poking the rendered colour they
 * survive the repaint that happens on every hover and press. Set inside
 * onInitialized because the visual does not exist before then.
 *
 * All three states are written together. Setting only the default leaves the
 * theme's grey hover, so the button changes hue under your gaze — which reads
 * as a glitch rather than as feedback.
 */
export function tintButtonFill(button: Button): void {
  button.onInitialized.add(() => {
    const visual = (button as unknown as {
      visual?: {
        defaultGradient?: unknown; hoveredGradient?: unknown; triggeredGradient?: unknown;
      };
    }).visual;
    if (visual === undefined || visual === null) return;
    // The button style paints a GRADIENT, not a flat colour, so baseDefaultColor
    // is read and then ignored — setting it looks like it works and changes
    // nothing on screen. These are the setters that actually reach the shader.
    visual.defaultGradient = buttonGradient(1);
    visual.hoveredGradient = buttonGradient(1.5);
    visual.triggeredGradient = buttonGradient(2.0);
  });
}

/** Face gradient at a brightness, so the three states stay one family. */
function buttonGradient(gain: number): {
  type: string; start: vec2; end: vec2;
  stop0: { enabled: boolean; color: vec4; percent: number };
  stop1: { enabled: boolean; color: vec4; percent: number };
} {
  const lift = (v: number, k: number): number => Math.min(1, v * gain * k);
  const c = Config.ui.button;
  return {
    type: 'Linear',
    start: new vec2(-1, 1),
    end: new vec2(1, -1),
    stop0: {
      enabled: true,
      color: new vec4(lift(c.r, 1.5), lift(c.g, 1.5), lift(c.b, 1.25), 1),
      percent: 0,
    },
    stop1: {
      enabled: true,
      color: new vec4(lift(c.r, 0.6), lift(c.g, 0.6), lift(c.b, 0.68), 1),
      percent: 1,
    },
  };
}

/** A UIKit button with a width-budgeted label on its face. */
export function makeButton(
  parent: SceneObject, font: Font | null, label: string,
  widthCm: number, heightCm: number, onPress: () => void,
): Button {
  const object = makeObject(parent, `Button ${label}`);
  const button = object.createComponent(Button.getTypeName()) as Button;
  button.size = new vec3(widthCm, heightCm, 1);

  // Outline, not fill. UIKit's button styles are neutral greys chosen against
  // a grey theme, and on the darker panel they were nearly invisible — the
  // label floated with no sense of a pressable edge. Tinting the fill means
  // writing UIKit's per-state private colour map, which is re-applied on every
  // hover; an outline is a plain mesh that no state change can undo, and on an
  // additive display a bright thin edge reads better than a dim filled slab.
  addButtonRim(object, widthCm, heightCm);
  tintButtonFill(button);
  feelPress(button, object);

  const labelObject = makeObject(object, 'Label', new vec3(0, 0, BUTTON_LABEL_Z));
  makeTextOn(labelObject, font, label, {
    role: 'Button', widthCm: widthCm - 0.5, heightCm: heightCm * 0.6,
  });

  button.onTriggerUp.add(() => onPress());
  return button;
}
