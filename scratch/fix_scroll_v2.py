
import sys

lines = open('frontend/src/App.tsx', 'r').readlines()

# Wrap pre tag (lines 1686-1689 approx)
# We look for the <pre that has ref={scrollRef}
for i, line in enumerate(lines):
    if 'ref={scrollRef}' in line and '<pre' in lines[i-1]:
        lines[i-1] = lines[i-1].replace('<pre', '<div className="flex-1 relative flex flex-col group/console overflow-hidden">\n                        <pre')
        # Add onScroll to the pre tag
        lines[i] = lines[i].replace('ref={scrollRef}', 'ref={scrollRef}\n                           onScroll={(e) => {\n                              const target = e.currentTarget;\n                              const atBottom = target.scrollHeight - target.scrollTop <= target.clientHeight + 40;\n                              setAutoScrollEnabled(atBottom);\n                           }}')
        break

# Add closing div and button after </pre> (around 1719)
for i, line in enumerate(lines):
    if '</pre>' in line and i > 1680 and i < 1800:
        lines[i] = line.replace('</pre>', '''                     </pre>
                        
                        {!autoScrollEnabled && (
                           <button 
                              onClick={() => {
                                 setAutoScrollEnabled(true);
                                 if (scrollRef.current) {
                                    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
                                 }
                              }}
                              className="absolute bottom-6 left-1/2 -translate-x-1/2 bg-[#3E8ED0] hover:bg-[#2B6A9E] text-white px-4 py-2 rounded-full shadow-2xl flex items-center gap-2 text-xs font-bold animate-in fade-in slide-in-from-bottom-2 duration-300 border border-white/10 z-10"
                           >
                              <ArrowDown className="w-3 h-3" />
                              Jump to Bottom
                           </button>
                        )}
                     </div>''')
        break

with open('frontend/src/App.tsx', 'w') as f:
    f.writelines(lines)
