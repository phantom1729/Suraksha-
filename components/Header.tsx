
import React from 'react';
import { ViewMode, Gender } from '../types';

interface HeaderProps {
  viewMode: ViewMode;
  onReset: () => void;
  onToggleVoice: () => void;
  gender: Gender;
}

const Header: React.FC<HeaderProps> = ({ viewMode, onReset, onToggleVoice, gender }) => {
  const themeClass = gender === 'female' ? 'text-rose-600' : 'text-indigo-600';
  
  return (
    <header className="glass sticky top-0 z-50 p-4 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors duration-500 ${gender === 'female' ? 'bg-rose-100' : 'bg-indigo-100'}`}>
          <span className={`font-black text-xl ${themeClass}`}>S</span>
        </div>
        <div>
          <h1 className="font-bold text-slate-800 text-lg tracking-tight">Sahara</h1>
          {gender && (
            <p className={`text-[10px] font-bold uppercase tracking-widest ${themeClass}`}>
              {gender === 'female' ? 'Badi Behen' : 'Bada Bhai'} Mode
            </p>
          )}
        </div>
      </div>

      <div className="flex gap-2">
        {gender && viewMode !== 'onboarding' && (
          <button 
            onClick={onToggleVoice}
            className={`p-2 rounded-lg transition-all ${viewMode === 'voice' ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
          >
            {viewMode === 'voice' ? (
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.827-1.233L3 21l1.833-4.833A9.946 9.946 0 013 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
              </svg>
            )}
          </button>
        )}
        {gender && (
          <button onClick={onReset} className="text-slate-400 hover:text-slate-600 p-2">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        )}
      </div>
    </header>
  );
};

export default Header;
