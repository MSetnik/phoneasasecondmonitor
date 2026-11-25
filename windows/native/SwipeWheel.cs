// Windows controls commonly consume whole wheel notches (120 units).
// Keep sub-notch finger travel until the next sample on the same axis.
internal sealed class SwipeWheel {
    const int PixelsPerNotch=24;
    double horizontal,vertical;
    public void Reset(){horizontal=vertical=0;}
    static int Notches(ref double remainder,double pixels){
        remainder+=pixels;
        int count=(int)(remainder/PixelsPerNotch);
        remainder-=count*PixelsPerNotch;
        return count;
    }
    public void Move(double dx,double dy,out int x,out int y){
        x=Notches(ref horizontal,-dx);
        y=Notches(ref vertical,dy);
    }
}
