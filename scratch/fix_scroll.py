
import sys

content = open('frontend/src/App.tsx', 'r').read()

# Target for console wrapper
target = '''                     <pre 
                        ref={scrollRef}
                        className="flex-1 bg-[#0D0D0D] rounded-t-lg border border-[#333] p-5 overflow-auto text-xs font-mono text-emerald-400/90 whitespace-pre-wrap selection:bg-[#3E8ED0]/40 shadow-inner"
                     >'''

replacement = '''                     <div className="flex-1 relative flex flex-col group/console overflow-hidden">
                        <pre 
                           ref={scrollRef}
                           onScroll={(e) => {
                              const target = e.currentTarget;
                              const atBottom = target.scrollHeight - target.scrollTop <= target.clientHeight + 40;
                              setAutoScrollEnabled(atBottom);
                           }}
                           className="flex-1 bg-[#0D0D0D] rounded-t-lg border border-[#333] p-5 overflow-auto text-xs font-mono text-emerald-400/90 whitespace-pre-wrap selection:bg-[#3E8ED0]/40 shadow-inner"
                        >'''

if target in content:
    content = content.replace(target, replacement)
    print("Wrapped pre tag")
else:
    # Try with different line endings or whitespace if needed
    print("Target not found exactly")

# Second target: the closing </pre>
# Note: There are multiple </pre> tags, so we need a specific one.
# We'll look for the one right before the command input div.
target2 = '''                     </pre>

                    <div className="flex bg-[#1A1A1A] border-x border-b border-[#333] rounded-b-lg p-3 gap-3">'''

replacement2 = '''                     </pre>
                        
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
                     </div>

                    <div className="flex bg-[#1A1A1A] border-x border-b border-[#333] rounded-b-lg p-3 gap-3">'''

if target2 in content:
    content = content.replace(target2, replacement2)
    print("Added jump button")
else:
    print("Target 2 not found")

with open('frontend/src/App.tsx', 'w') as f:
    f.write(content)
