# Modal Centering Fix for Mobile

## Issue
On mobile devices, the safety protocols, pre-session and post-session modals need to be centered between the header and footer for all content to be visible.

## Solution Applied

### Changes Made:

1. **Pre-Session Modal (ExperienceTracker.tsx)**
   - Changed from: `pt-20` and `pb-24` with `h-[75vh]`
   - Changed to: `flex items-center justify-center` with `max-h-[calc(100vh-120px)]`
   - Added `my-auto` for vertical centering

2. **Post-Session Modal (ExperienceTracker.tsx)**
   - Same changes as Pre-Session Modal
   - Ensures consistent behavior

3. **Break Reminder Modal (SafetyProtocols.tsx)**
   - Added `max-h-[calc(100vh-120px)]` and `overflow-y-auto`
   - Added `my-auto` for vertical centering

4. **Other Modals in App.tsx**
   - Quick Guide Modal
   - Disclaimer Modal
   - Frequency Selector Modal
   - Recording Options Modal
   - Info Modal
   - All updated with `max-h-[calc(100vh-120px)]` and `my-auto`

### Key Changes:

1. **Removed fixed positioning offsets**: Removed `pt-20` (padding-top) and `pb-24` (padding-bottom) from modal containers
2. **Used flexbox centering**: `flex items-center justify-center` ensures proper centering
3. **Dynamic height calculation**: `max-h-[calc(100vh-120px)]` leaves ~60px space at top and bottom for header/footer
4. **Vertical auto margins**: `my-auto` helps with additional centering
5. **Overflow handling**: Added `overflow-y-auto` where needed to handle content that exceeds available space

### Testing Instructions:

1. **Test on Mobile Devices**:
   - Open the app on a mobile device or use browser dev tools mobile view
   - Test each modal:
     - Pre-session modal (Start Experience Documentation)
     - Post-session modal (End Experience Documentation)
     - Break reminder (appears during long sessions)
     - Safety protocols panel
     - All other modals

2. **Check for**:
   - Modal content is fully visible
   - No content is cut off at top or bottom
   - Scrolling works when content exceeds available space
   - Modals are properly centered between header and footer

3. **Different Screen Sizes**:
   - Test on various mobile screen sizes
   - Ensure modals adapt properly to different viewport heights

### Benefits:

1. **Better Mobile UX**: All modal content is accessible on mobile devices
2. **Consistent Behavior**: All modals use the same centering approach
3. **Responsive Design**: Adapts to different screen sizes
4. **No Content Loss**: Users can access all modal content through scrolling if needed
5. **Professional Appearance**: Properly centered modals look more polished

### Additional Notes:

- The `120px` in `calc(100vh-120px)` accounts for typical header + footer heights
- The `my-auto` class provides additional vertical centering
- Overflow scrolling is enabled where content might exceed available space
- All modals maintain their backdrop blur and animations