import React, { useEffect, useRef } from 'react';

/** แสดง canvas ของ compositor ลงในหน้าจอ preview (canvas เดียวกับที่ส่งไลฟ์) */
export default function Preview({ compositor }) {
  const holderRef = useRef(null);

  useEffect(() => {
    if (!compositor || !holderRef.current) return;
    const cvs = compositor.canvas;
    cvs.classList.add('preview-canvas');
    holderRef.current.appendChild(cvs);
    return () => {
      if (cvs.parentNode === holderRef.current) holderRef.current.removeChild(cvs);
    };
  }, [compositor]);

  return <div className="preview-holder" ref={holderRef} />;
}
