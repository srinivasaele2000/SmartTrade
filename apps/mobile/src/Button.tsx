import {useRef, useState} from 'react';
import {ActivityIndicator, Pressable, StyleSheet, Text, View} from 'react-native';
import {ArrowLeft, ArrowRight, Check, Download, Edit3, Eye, FilePlus2, LogOut, Plus, RefreshCw, Save, Search, Send, ShoppingBag, Trash2, User, X, type LucideIcon} from 'lucide-react-native';
import {trade} from './trade-theme';

export type ButtonVariant = 'primary' | 'secondary' | 'tertiary' | 'destructive' | 'navigation';
export type ButtonIcon = 'back' | 'next' | 'check' | 'download' | 'edit' | 'view' | 'file' | 'logout' | 'plus' | 'refresh' | 'save' | 'search' | 'send' | 'delete' | 'close' | 'browse' | 'account';
const icons: Record<ButtonIcon, LucideIcon> = {back:ArrowLeft,next:ArrowRight,check:Check,download:Download,edit:Edit3,view:Eye,file:FilePlus2,logout:LogOut,plus:Plus,refresh:RefreshCw,save:Save,search:Search,send:Send,delete:Trash2,close:X,browse:ShoppingBag,account:User};
export const buttonPalette = {
  primary: {backgroundColor:trade.accent, borderColor:trade.accent, color:trade.surface},
  secondary: {backgroundColor:trade.surface, borderColor:trade.border, color:trade.accent},
  tertiary: {backgroundColor:'transparent', borderColor:'transparent', color:trade.accent},
  destructive: {backgroundColor:'#B42318', borderColor:'#B42318', color:'#FFFFFF'},
  navigation: {backgroundColor:trade.screen, borderColor:trade.border, color:trade.secondary},
  selected: {backgroundColor:trade.accentTint, borderColor:trade.accent, color:trade.accent},
  disabled: {backgroundColor:trade.screen, borderColor:trade.border, color:trade.muted},
} as const;

type Props = {title:string; onPress:()=>unknown; variant?:ButtonVariant; icon?:ButtonIcon; disabled?:boolean; loading?:boolean; selected?:boolean; accessibilityLabel?:string; compact?:boolean};
/** Action intent is explicit at each call site; labels never determine permissions or styling. */
export function Button({title,onPress,variant='secondary',icon,disabled=false,loading=false,selected=false,accessibilityLabel,compact=false}:Props) {
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
  return <Pressable accessibilityRole={variant==='navigation'?'tab':'button'} accessibilityLabel={accessibilityLabel??title} accessibilityState={{disabled:unavailable,busy, ...(variant==='navigation'?{selected}:{})}} disabled={unavailable} onPress={press} hitSlop={compact ? {top: 6, bottom: 6, left: 2, right: 2} : undefined} style={({pressed})=>[s.button,{backgroundColor:palette.backgroundColor,borderColor:palette.borderColor},variant==='navigation'&&s.navigation,compact&&s.compact,pressed&&!unavailable&&s.pressed]}>
    <View style={s.content}>
      {busy?<ActivityIndicator size="small" color={palette.color} accessibilityLabel="Processing" />:Icon?<Icon size={18} strokeWidth={2} color={palette.color} aria-hidden={true}/>:null}
      <Text style={[s.label,{color:palette.color}]}>{title}</Text>
      {variant==='navigation'&&selected&&!busy&&<Check size={16} color={palette.color} aria-hidden={true}/>}
    </View>
  </Pressable>;
}
const s=StyleSheet.create({
  button:{minHeight:48,paddingVertical:8,paddingHorizontal:12,borderRadius:9,borderWidth:1,justifyContent:'center',maxWidth:'100%',flexShrink:1},
  navigation:{borderRadius:8,paddingHorizontal:10},
  compact:{minHeight:28,minWidth:40,paddingVertical:3,paddingHorizontal:8,borderRadius:trade.radius},
  content:{flexDirection:'row',alignItems:'center',justifyContent:'center',gap:6},
  label:{fontSize:13,fontWeight:'600',lineHeight:18,textAlign:'center',flexShrink:1},
  pressed:{opacity:0.78,transform:[{scale:0.99}]},
});
