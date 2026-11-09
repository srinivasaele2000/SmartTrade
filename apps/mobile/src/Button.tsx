import {useRef, useState} from 'react';
import {ActivityIndicator, Pressable, StyleSheet, Text, View} from 'react-native';
import {ArrowLeft, ArrowRight, Check, Download, Edit3, Eye, FilePlus2, LogOut, Plus, RefreshCw, Save, Search, Send, Trash2, X, type LucideIcon} from 'lucide-react-native';

export type ButtonVariant = 'primary' | 'secondary' | 'tertiary' | 'destructive' | 'navigation';
export type ButtonIcon = 'back' | 'next' | 'check' | 'download' | 'edit' | 'view' | 'file' | 'logout' | 'plus' | 'refresh' | 'save' | 'search' | 'send' | 'delete' | 'close';
const icons: Record<ButtonIcon, LucideIcon> = {back:ArrowLeft,next:ArrowRight,check:Check,download:Download,edit:Edit3,view:Eye,file:FilePlus2,logout:LogOut,plus:Plus,refresh:RefreshCw,save:Save,search:Search,send:Send,delete:Trash2,close:X};
export const buttonPalette = {
  primary: {backgroundColor:'#14553E', borderColor:'#14553E', color:'#FFFFFF'},
  secondary: {backgroundColor:'#FFFFFF', borderColor:'#7D9F8F', color:'#14553E'},
  tertiary: {backgroundColor:'transparent', borderColor:'transparent', color:'#14553E'},
  destructive: {backgroundColor:'#B42318', borderColor:'#B42318', color:'#FFFFFF'},
  navigation: {backgroundColor:'#F0F4F2', borderColor:'transparent', color:'#435B50'},
  selected: {backgroundColor:'#D9EDE3', borderColor:'#24734F', color:'#124B35'},
  disabled: {backgroundColor:'#E6EBE8', borderColor:'#D3DDD7', color:'#66786E'},
} as const;

type Props = {title:string; onPress:()=>unknown; variant?:ButtonVariant; icon?:ButtonIcon; disabled?:boolean; loading?:boolean; selected?:boolean; accessibilityLabel?:string};
/** Action intent is explicit at each call site; labels never determine permissions or styling. */
export function Button({title,onPress,variant='secondary',icon,disabled=false,loading=false,selected=false,accessibilityLabel}:Props) {
  const gate = useRef(false);
  const [pending,setPending] = useState(false);
  const busy = loading || pending;
  const unavailable = disabled || busy;
  const palette = unavailable ? buttonPalette.disabled : variant==='navigation' && selected ? buttonPalette.selected : buttonPalette[variant];
  const Icon = icon ? icons[icon] : null;
  function press() {
    if(unavailable || gate.current)return;
    gate.current=true;
    try {
      const result=onPress();
      if(result && typeof (result as PromiseLike<unknown>).then==='function') {
        setPending(true);
        const release=()=>{gate.current=false;setPending(false);};
        void Promise.resolve(result).then(release,release);
      } else {
        // Existing handlers often start async work then set their own busy flag.
        // Bridge the render gap without altering their requests or validation.
        setTimeout(()=>{gate.current=false;},350);
      }
    } catch(error) {gate.current=false;throw error;}
  }
  return <Pressable accessibilityRole={variant==='navigation'?'tab':'button'} accessibilityLabel={accessibilityLabel??title} accessibilityState={{disabled:unavailable,busy, ...(variant==='navigation'?{selected}:{})}} disabled={unavailable} onPress={press} style={({pressed})=>[s.button,{backgroundColor:palette.backgroundColor,borderColor:palette.borderColor},variant==='navigation'&&s.navigation,pressed&&!unavailable&&s.pressed]}>
    <View style={s.content}>
      {busy?<ActivityIndicator size="small" color={palette.color} accessibilityLabel="Processing" />:Icon?<Icon size={18} strokeWidth={2} color={palette.color} accessible={false}/>:null}
      <Text style={[s.label,{color:palette.color}]}>{title}</Text>
      {variant==='navigation'&&selected&&!busy&&<Check size={16} color={palette.color} accessible={false}/>}
    </View>
  </Pressable>;
}
const s=StyleSheet.create({
  button:{minHeight:48,paddingVertical:12,paddingHorizontal:16,borderRadius:10,borderWidth:1,justifyContent:'center',maxWidth:'100%',flexShrink:1},
  navigation:{borderRadius:8,paddingHorizontal:12},
  content:{flexDirection:'row',alignItems:'center',justifyContent:'center',gap:8},
  label:{fontSize:15,fontWeight:'600',lineHeight:21,textAlign:'center',flexShrink:1},
  pressed:{opacity:0.78,transform:[{scale:0.99}]},
});
