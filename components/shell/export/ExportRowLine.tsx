// components/shell/export/ExportRowLine.tsx (v16.5, Export with layers; the addendum §3.10 table 1)
//
// An "Export with layers…" row's line: its own words, or, while an export runs, "Exporting · 62 %" (the progress leaf).

import React from 'react';
import { useExport } from '../contexts';
import ExportProgress from './ExportProgress';

const ExportRowLine = ({ text }: { text: string }) => {
  const { job } = useExport();
  if (job && (job.phase === 'running' || job.phase === 'cancelling')) return <ExportProgress store={job.store} look="row" />;
  return <>{text}</>;
};

export default React.memo(ExportRowLine);
