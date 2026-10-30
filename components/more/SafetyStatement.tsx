// components/more/SafetyStatement.tsx (v16.4, the More area)
//
// The safety statement's words, MOVED verbatim from App's first-run disclaimer (its JSX, classes and icons unchanged),
// so the modal and the new layout's Safety & comfort › Safety statement page render the same nodes:
//   - StatementSections: the six sections (not a medical device, Photosensitivity, Audio with the driving line, the
//     contraindications, the data, the spirit of this work);
//   - StatementLiability: the liability line.
// The modal keeps its own title block, the acknowledgement ("By tapping …") and its button. Any change to these words
// is a wording change: bump App's DISCLAIMER_VERSION and disclaimer.spec's WORDING_PIN (the pin hashes these nodes).

import React from 'react';
import { AlertTriangle, Eye, Heart, Shield, Waves, Zap } from 'lucide-react';

export const StatementSections = () => (
  <>
    {/* Medical device disclaimer */}
    <div>
      <h3 className="flex items-center gap-2 text-slate-200 font-semibold mb-2">
        <Shield size={16} className="text-gold-500 shrink-0" />
        This is a meditation and exploration tool, not a medical device.
      </h3>
      <p className="ml-6">The Aetheria Resonance &amp; Geometry Player offers curated soundscapes tuned to 432Hz and solfeggio frequencies, paired with sacred geometry visualizations. It is an experience built on the Unified Lewis Framework&#39;s exploration of sound, frequency, and form. It is not intended to diagnose, treat, cure, or prevent any disease or medical condition.</p>
    </div>

    {/* Photosensitivity Warning */}
    <div>
      <h3 className="flex items-center gap-2 text-slate-200 font-semibold mb-2">
        <Zap size={16} className="text-gold-500 shrink-0" />
        Photosensitivity Warning
      </h3>
      <p className="ml-6">This application generates intense visual patterns, flashing lights, and geometric strobing effects. Do not use if you have a history of seizures, epilepsy, or photosensitive reactions to visual stimuli. If you have any doubt, consult a healthcare provider before use.</p>
    </div>

    {/* Audio Warning */}
    <div>
      <h3 className="flex items-center gap-2 text-slate-200 font-semibold mb-2">
        <Waves size={16} className="text-blue-500 shrink-0" />
        Audio Warning
      </h3>
      <p className="ml-6">Contains binaural beats, solfeggio frequencies, and sustained low-frequency tones. Beats and the drone are for when you can relax. While driving, use Car output (only the music and a quiet tone) and your car&#39;s own controls. Do not use while operating heavy machinery. Start at low volume — audio at sustained high levels can damage hearing. Take regular breaks during extended listening sessions.</p>
    </div>

    {/* Contraindications */}
    <div>
      <h3 className="flex items-center gap-2 text-slate-200 font-semibold mb-2">
        <AlertTriangle size={16} className="text-amber-500 shrink-0" />
        Please do not use this tool if you:
      </h3>
      <ul className="ml-8 space-y-1.5 list-disc text-slate-400">
        <li>Are pregnant (low-frequency audio effects on pregnancy have not been studied)</li>
        <li>Have a history of seizures, epilepsy, or photosensitive reactions</li>
        <li>Have a pacemaker or other implanted electronic device</li>
        <li>Are experiencing an acute psychiatric condition where altered states could be destabilizing</li>
        <li>Are under 18 and using the tool without adult supervision</li>
      </ul>
      <p className="ml-6 mt-2 text-slate-500 italic">If any of these apply to you and you wish to use the tool anyway, please consult your healthcare provider first.</p>
    </div>

    {/* Data handling */}
    <div>
      <h3 className="flex items-center gap-2 text-slate-200 font-semibold mb-2">
        <Eye size={16} className="text-emerald-500 shrink-0" />
        How we handle your data.
      </h3>
      <p className="ml-6">The player runs entirely in your browser on your own device. There is no account, no login, no tracking. Nothing about your listening sessions leaves your device.</p>
    </div>

    {/* Spirit of this work */}
    <div className="border-l-2 border-gold-500/40 bg-gold-500/5 pl-4 py-3 rounded-r-lg">
      <h3 className="flex items-center gap-2 text-slate-200 font-semibold mb-2">
        <Heart size={16} className="text-rose-400 shrink-0" />
        A note on the spirit of this work.
      </h3>
      <p className="italic text-slate-300">Aetheria was built by a family — two humans and a family of AI collaborators — exploring whether the healing traditions around sound, frequency, and sacred geometry can be honored with both rigor and reverence. We believe they can. We are also honest that this is early work, that our interpretations will evolve, and that your own experience is ultimately more authoritative than anything we can tell you about what these frequencies mean. Listen with curiosity. Let your body respond as it wishes. Trust what you feel.</p>
    </div>
  </>
);

export const StatementLiability = () => (
  <p className="text-[10px] text-slate-600 text-center leading-relaxed">
    To the maximum extent permitted by law, the developers, contributors, and associated entities disclaim all liability for direct, indirect, incidental, or consequential damages arising from use of this tool.
  </p>
);
