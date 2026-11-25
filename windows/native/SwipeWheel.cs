// Windows controls commonly consume whole wheel notches (120 units).
// Keep sub-notch finger travel until the next sample on the same axis.
internal sealed class SwipeWheel {
    int pixelsPerNotch=48;
    double horizontal,vertical;
    public void Reset(){horizontal=vertical=0;}
    public void SetPixelsPerNotch(int pixels){
        if(pixels!=24 && pixels!=48 && pixels!=96)throw new System.ArgumentOutOfRangeException("pixels");
        if(pixels==pixelsPerNotch)return;
        pixelsPerNotch=pixels;
        Reset();
    }
    int Notches(ref double remainder,double pixels){
        remainder+=pixels;
        int count=(int)(remainder/pixelsPerNotch);
        remainder-=count*pixelsPerNotch;
        return count;
    }
    public void Move(double dx,double dy,out int x,out int y){
        x=Notches(ref horizontal,-dx);
        y=Notches(ref vertical,dy);
    }
}
