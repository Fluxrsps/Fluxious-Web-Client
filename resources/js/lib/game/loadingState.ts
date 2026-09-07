import { readonly, ref } from 'vue';

/**
 * Loading progress for the game client.
 *
 * Two sources report into this and they never overlap: the boot sequence while the cache is
 * prepared and the client is downloaded, then the client itself once it is running. Both arrive
 * through `window.FluxLoading`, which the client's canvas script calls instead of drawing its own
 * progress bar.
 *
 * What the bar shows is one number for the whole launch, not whichever step happens to be running.
 * That takes work, because the client has no concept of a launch: it reports 0 to 100 afresh for
 * every stage it goes through ("Loading - please wait", "Loaded world map", and so on), and it does
 * not know how many are left. So each stage is folded into the space still available above the last
 * one, and the number is never allowed to fall.
 */
const visible = ref(false);
const progress = ref(0);
const status = ref('');

/** A frame only counts as "loading finished" if nothing reported progress this recently. */
const QUIET_PERIOD_MS = 400;
let lastUpdate = 0;

/** Where the boot sequence hands over; everything above this belongs to the client's own stages. */
const CLIENT_PHASE_START = 82;

/**
 * How much of the remaining space a single client stage may consume.
 *
 * Less than all of it, because there is no way to know whether a stage is the last one. Each stage
 * takes this share of what is left, so the bar keeps moving and closes on 100 without ever claiming
 * to have arrived. It disappears on the first painted frame regardless — see `reportFrame`.
 */
const CLIENT_STAGE_SHARE = 0.6;

let stageFloor = CLIENT_PHASE_START;
let stageCeiling = CLIENT_PHASE_START + (100 - CLIENT_PHASE_START) * CLIENT_STAGE_SHARE;
let lastStageValue = -1;

export const loadingVisible = readonly(visible);
export const loadingProgress = readonly(progress);
export const loadingStatus = readonly(status);

/**
 * Reports absolute launch progress. Used directly by the boot sequence, which knows its own steps.
 *
 * The value only ever climbs: a bar that goes backwards reads as a fault even when nothing is
 * wrong, and every source feeding this reports progress within a step rather than across the whole.
 */
export function reportLoading(value: number, message: string): void {
    lastUpdate = Date.now();
    visible.value = true;
    progress.value = Math.max(progress.value, Math.max(0, Math.min(100, value)));

    if (message) {
        status.value = message;
    }
}

/**
 * Reports progress within one of the client's own loading stages.
 *
 * A value lower than the last one means the client has started a new stage and reset its counter,
 * which is the only signal available that one stage ended and another began.
 */
export function reportClientLoading(value: number, message: string): void {
    const stageValue = Math.max(0, Math.min(100, value));
    const firstReport = lastStageValue < 0;

    // On the first report, start from wherever boot actually left off rather than the nominal
    // handover point: its easing drifts a little past it while waiting on the last step.
    if (firstReport || stageValue < lastStageValue - 1) {
        stageFloor = firstReport ? Math.max(CLIENT_PHASE_START, progress.value) : progress.value;
        stageCeiling = stageFloor + (100 - stageFloor) * CLIENT_STAGE_SHARE;
    }

    lastStageValue = stageValue;

    reportLoading(stageFloor + (stageValue / 100) * (stageCeiling - stageFloor), message);
}

/**
 * Called when the client paints a real frame.
 *
 * A frame can land in the same tick as a final progress update, so this waits for a quiet period
 * before hiding — otherwise the screen flickers off and on between the client's loading steps.
 */
export function reportFrame(): void {
    if (!visible.value || Date.now() - lastUpdate < QUIET_PERIOD_MS) {
        return;
    }

    visible.value = false;
}

export function installLoadingBridge(): void {
    window.FluxLoading = { report: reportClientLoading, frame: reportFrame };
}
