package com.michaelunkai.daymark;

import android.content.Context;
import android.util.AttributeSet;
import android.view.View;
import android.view.ViewGroup;

/**
 * Minimal wrapping row layout: children are laid out left-to-right and wrap to
 * the next row when the available width is exceeded. Used for card action rows
 * and the header chips so no pill row ever needs horizontal scrolling.
 * Gaps are 8dp horizontal and vertical.
 */
final class FlowLayout extends ViewGroup {

    private final int hGap;
    private final int vGap;

    FlowLayout(Context context) {
        this(context, Math.round(context.getResources().getDisplayMetrics().density * 8),
                Math.round(context.getResources().getDisplayMetrics().density * 8));
    }

    private FlowLayout(Context context, int hGap, int vGap) {
        super(context);
        this.hGap = hGap;
        this.vGap = vGap;
    }

    @Override
    protected void onMeasure(int widthMeasureSpec, int heightMeasureSpec) {
        int maxWidth = MeasureSpec.getSize(widthMeasureSpec)
                - getPaddingLeft() - getPaddingRight();
        final int count = getChildCount();
        int rowWidth = 0;
        int rowHeight = 0;
        int totalWidth = 0;
        int totalHeight = getPaddingTop() + getPaddingBottom();
        for (int index = 0; index < count; index += 1) {
            final View child = getChildAt(index);
            if (child.getVisibility() == GONE) continue;
            measureChildWithMargins(child, widthMeasureSpec, 0, heightMeasureSpec, 0);
            MarginLayoutParams params = (MarginLayoutParams) child.getLayoutParams();
            int childWidth = child.getMeasuredWidth() + params.leftMargin + params.rightMargin;
            int childHeight = child.getMeasuredHeight() + params.topMargin + params.bottomMargin;
            if (rowWidth > 0 && rowWidth + hGap + childWidth > maxWidth && maxWidth > 0) {
                totalHeight += rowHeight + vGap;
                rowWidth = 0;
                rowHeight = 0;
            }
            if (rowWidth > 0) rowWidth += hGap;
            rowWidth += childWidth;
            rowHeight = Math.max(rowHeight, childHeight);
            totalWidth = Math.max(totalWidth, rowWidth);
        }
        totalHeight += rowHeight;
        int resolvedWidth = resolveSize(totalWidth + getPaddingLeft() + getPaddingRight(),
                widthMeasureSpec);
        int resolvedHeight = resolveSize(totalHeight, heightMeasureSpec);
        setMeasuredDimension(resolvedWidth, resolvedHeight);
    }

    @Override
    protected void onLayout(boolean changed, int left, int top, int right, int bottom) {
        int maxWidth = right - left - getPaddingLeft() - getPaddingRight();
        int x = getPaddingLeft();
        int y = getPaddingTop();
        int rowHeight = 0;
        final int count = getChildCount();
        for (int index = 0; index < count; index += 1) {
            final View child = getChildAt(index);
            if (child.getVisibility() == GONE) continue;
            MarginLayoutParams params = (MarginLayoutParams) child.getLayoutParams();
            int childWidth = child.getMeasuredWidth();
            int childHeight = child.getMeasuredHeight();
            int rowWidth = x + params.leftMargin + childWidth + params.rightMargin - getPaddingLeft();
            if (x > getPaddingLeft() && rowWidth > maxWidth && maxWidth > 0) {
                x = getPaddingLeft();
                y += rowHeight + vGap;
                rowHeight = 0;
            }
            int childLeft = x + params.leftMargin;
            int childTop = y + params.topMargin;
            child.layout(childLeft, childTop,
                    childLeft + childWidth, childTop + childHeight);
            x = childLeft + childWidth + params.rightMargin;
            rowHeight = Math.max(rowHeight,
                    childHeight + params.topMargin + params.bottomMargin);
        }
    }

    @Override
    protected ViewGroup.LayoutParams generateDefaultLayoutParams() {
        return new ViewGroup.MarginLayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
    }

    @Override
    public ViewGroup.LayoutParams generateLayoutParams(AttributeSet attrs) {
        return new ViewGroup.MarginLayoutParams(getContext(), attrs);
    }

    @Override
    protected ViewGroup.LayoutParams generateLayoutParams(ViewGroup.LayoutParams source) {
        return new ViewGroup.MarginLayoutParams(source);
    }
}
