import React, { useState, useRef, useEffect } from 'react';
import { MonitorSmartphone, Smartphone, Tablet } from 'lucide-react';
import { clsx } from 'clsx';

type ViewMode = 'full' | 'mobile' | 'tablet';

export function DeviceSimulator({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useState<ViewMode>('full');
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const ActiveIcon = mode === 'full' ? MonitorSmartphone : mode === 'mobile' ? Smartphone : Tablet;

  const content = mode === 'full' ? (
    <div className="w-full min-h-screen">
      {children}
    </div>
  ) : (
    <div className={clsx(
      "transition-all duration-300 overflow-hidden shadow-2xl relative mx-auto mt-8 flex-shrink-0",
      mode === 'mobile' ? "w-[375px] h-[812px] border-[12px] border-black rounded-[3rem]" : 
      "w-[768px] h-[1024px] border-[12px] border-black rounded-[3rem]"
    )}>
       <div className="w-full h-full overflow-y-auto bg-[#FDFBF7] dark:bg-[#1C1917] relative scroll-smooth rounded-[2rem]">
          {children}
       </div>
    </div>
  );

  return (
    <div className={clsx(mode !== 'full' && "min-h-screen w-full bg-[#1e1e1e] overflow-y-auto flex items-start justify-center pb-8")}>
      {content}
      
      {/* Dropdown Floating Button */}
      <div className="fixed top-4 left-4 z-[9999]" ref={dropdownRef}>
        <button 
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center gap-2 bg-[#171717] text-[#EDEDED] px-3 py-2 rounded-xl border border-[#2a2a2a] hover:bg-[#262626] transition-colors shadow-lg"
        >
          <ActiveIcon size={22} strokeWidth={1.5} />
          <span className="text-xl font-light text-[#737373] -mt-0.5">/</span>
        </button>

        {isOpen && (
          <div className="absolute top-full left-0 mt-2 w-[220px] bg-[#171717] border border-[#2a2a2a] rounded-xl shadow-2xl overflow-hidden py-1.5 animate-in fade-in slide-in-from-top-2 duration-200">
            <button 
              onClick={() => { setMode('full'); setIsOpen(false); }}
              className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-[#262626] text-[#EDEDED] transition-colors text-left"
            >
              <MonitorSmartphone size={18} strokeWidth={1.5} className="text-[#a3a3a3]" />
              <span className="font-medium text-[15px]">Current screen size</span>
            </button>
            <button 
              onClick={() => { setMode('mobile'); setIsOpen(false); }}
              className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-[#262626] text-[#EDEDED] transition-colors text-left"
            >
              <Smartphone size={18} strokeWidth={1.5} className="text-[#a3a3a3]" />
              <span className="font-medium text-[15px]">Mobile</span>
            </button>
            <button 
              onClick={() => { setMode('tablet'); setIsOpen(false); }}
              className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-[#262626] text-[#EDEDED] transition-colors text-left"
            >
              <Tablet size={18} strokeWidth={1.5} className="text-[#a3a3a3]" />
              <span className="font-medium text-[15px]">Tablet</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
