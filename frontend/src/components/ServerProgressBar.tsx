// Shows `percent` only when the server reported one. Without it the bar slides
// back and forth and claims no amount of progress.
export function ServerProgressBar({ percent, trackClassName, fillClassName }: {
   percent?: number;
   trackClassName: string;
   fillClassName: string;
}) {
   if (!percent) {
      return (
         <div role="progressbar" aria-label="Server progress" className={`w-full rounded-full overflow-hidden ${trackClassName}`}>
            <div className={`h-full w-1/3 rounded-full animate-indeterminate ${fillClassName}`} />
         </div>
      );
   }
   const value = Math.min(100, percent);
   return (
      <div role="progressbar" aria-label="Server progress" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100} className={`w-full rounded-full overflow-hidden ${trackClassName}`}>
         <div className={`h-full rounded-full transition-all duration-300 ease-out ${fillClassName}`} style={{ width: `${value}%` }} />
      </div>
   );
}
