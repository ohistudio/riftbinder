// Binder — the LEAF scenario registry. Lens runtime, PREVIEW ONLY.
//
// LEAF finds scenarios through a static field carrying @scenariosIndex. The
// decorator's initialiser runs when this class is loaded, which only happens if
// the class is attached to something in the scene — so this component exists
// purely to be present.

import { scenariosIndex } from 'Leaf.lspkg/Scenarios/decorator/ScenarioIndexDecorator';
import type { ScenarioMetadata } from 'Leaf.lspkg/Scenarios/scenario/ScenarioMetadata';
import { ScanRehearsal } from './ScanRehearsal';
import { DeckBuildRehearsal } from './DeckBuildRehearsal';

@component
export class BinderScenarios extends BaseScriptComponent {
  @scenariosIndex
  static readonly scenarios: ScenarioMetadata[] = [
    { id: 'scan-rengar', typename: ScanRehearsal.getTypeName() },
    { id: 'deck-building', typename: DeckBuildRehearsal.getTypeName() },
  ];
}
