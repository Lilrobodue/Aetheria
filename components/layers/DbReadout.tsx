// components/layers/DbReadout.tsx
//
// The readout beside a v2 level slider ("+0.0 dB · −26.0 dB re music"). The
// same text is the slider's aria-valuetext, so App builds it once (layerCopy)
// and passes the string; memo keeps App's renders while playing (a few a
// second since v14.8's quarter-second clock) from touching it.

import React from 'react';

interface Props {
  text: string;
  id?: string;
}

const DbReadout: React.FC<Props> = ({ text, id }) => (
  <span id={id} className="tabular-nums">{text}</span>
);

export default React.memo(DbReadout);
