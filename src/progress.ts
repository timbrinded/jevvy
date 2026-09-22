export type ScanStage = 'capture' | 'extract' | 'plan' | 'analyse' | 'persist' | 'complete' | 'failed';
export interface ScanProgress {
  runId: string;
  startedAt: number;
  stage: ScanStage;
  dryRun: boolean;
  pack?: 'comments' | 'functions' | 'tests';
  file?: string;
  files: { completed: number; total: number };
  comments: number;
  packets: {
    total: number;
    completed: number;
    active: number;
    ok: number;
    partial: number;
    error: number;
    cancelled: number;
    cached: number;
  };
}

export function initialProgress(
  runId: string,
  dryRun: boolean,
  startedAt = Date.now(),
  pack?: ScanProgress['pack'],
): ScanProgress {
  return {
    runId,
    startedAt,
    stage: 'capture',
    dryRun,
    ...(pack ? { pack } : {}),
    files: { completed: 0, total: 0 },
    comments: 0,
    packets: { total: 0, completed: 0, active: 0, ok: 0, partial: 0, error: 0, cancelled: 0, cached: 0 },
  };
}

export function progressText(p: ScanProgress): string {
  const units = p.pack ?? 'comments';
  switch (p.stage) {
    case 'capture':
      return 'Capturing source';
    case 'extract':
      return `Extracting ${units} · ${p.files.completed}/${p.files.total} files`;
    case 'plan':
      return `${p.comments} ${units} · ${p.packets.total} packets planned`;
    case 'analyse':
      return `Analysing ${units} · ${p.packets.completed}/${p.packets.total} packets · ${p.packets.active} active`;
    case 'persist':
      return 'Saving results';
    case 'complete':
      return p.dryRun ? 'Preview saved' : 'Results saved';
    case 'failed':
      return 'Scan failed';
  }
}
