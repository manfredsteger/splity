import React from 'react';
import { Upload } from 'lucide-react';

interface DragOverlayProps {
  isDragging: boolean;
}

export const DragOverlay: React.FC<DragOverlayProps> = ({ isDragging }) => {
  if (!isDragging) return null;

  return (
    <div className="fixed inset-0 z-50 bg-blue-600/80 backdrop-blur-md flex flex-col items-center justify-center text-white pointer-events-none transition-all duration-200 animate-in fade-in">
      <div className="w-24 h-24 rounded-3xl bg-white/20 flex items-center justify-center mb-6 shadow-2xl scale-110 transition-transform">
        <Upload className="w-12 h-12 text-white animate-bounce" />
      </div>
      <h2 className="text-3xl font-bold tracking-tight">Loslassen zum Hochladen</h2>
      <p className="text-blue-100 mt-2 text-base font-medium">
        Videodatei wird direkt verlustfrei analysiert
      </p>
    </div>
  );
};
