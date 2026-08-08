import React from 'react';
import {
  Camera, Monitor, Image as ImageIcon, Type, Mic,
  Trash2, Eye, EyeOff, Volume2, VolumeX, ChevronUp, ChevronDown,
} from 'lucide-react';

const ICONS = {
  camera: Camera, screen: Monitor, image: ImageIcon, text: Type, mic: Mic,
};
const NAMES = {
  camera: 'กล้อง', screen: 'จับหน้าจอ', image: 'รูปภาพ', text: 'ข้อความ', mic: 'ไมโครโฟน',
};

export default function SourceRow({ source, onToggleHidden, onToggleMuted, onRemove, onUp, onDown }) {
  const Icon = ICONS[source.type] || Type;
  const hasAudio = source.type === 'mic' || source.type === 'screen' || source.audioNode;
  const hasVisual = source.type !== 'mic';

  return (
    <div className={'source-row' + (source.hidden ? ' hidden' : '')}>
      <Icon size={16} className="src-icon" />
      <span className="src-name">
        {NAMES[source.type] || source.type}
        {source.type === 'text' && source.text ? `: ${source.text.slice(0, 14)}` : ''}
      </span>
      <div className="src-actions">
        {hasVisual && (
          <button className="iconbtn" onClick={onToggleHidden} title="ซ่อน/แสดง">
            {source.hidden ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
        )}
        {hasAudio && (
          <button className="iconbtn" onClick={onToggleMuted} title="ปิด/เปิดเสียง">
            {source.muted ? <VolumeX size={15} /> : <Volume2 size={15} />}
          </button>
        )}
        <button className="iconbtn" onClick={onUp} title="เลื่อนขึ้น"><ChevronUp size={15} /></button>
        <button className="iconbtn" onClick={onDown} title="เลื่อนลง"><ChevronDown size={15} /></button>
        <button className="iconbtn danger" onClick={onRemove} title="ลบ"><Trash2 size={15} /></button>
      </div>
    </div>
  );
}
