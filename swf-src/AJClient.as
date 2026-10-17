package
{
   import avatar.AvatarManager;
   import avatar.AvatarWorldView;
   import com.sbi.debug.DebugUtility;
   import com.sbi.graphics.PaletteHelper;
   import den.DenXtCommManager;
   import item.ItemXtCommManager;
   import den.DenItem;
   import den.DenXtCommManager;
   import item.Item;
   import item.ItemXtCommManager;
   import com.sbi.loader.ResourceStack;
   import com.sbi.popup.SBOkPopup;
   import com.sbi.popup.SBStandardPopup;
   import com.sbi.popup.SBYesNoPopup;
   import createAccountFlow.CreateAccount;
   import flash.display.MovieClip;
   import flash.display.Shape;
   import flash.display.DisplayObject;
   import flash.display.Sprite;
   import flash.events.Event;
   import flash.geom.ColorTransform;
   import flash.geom.Matrix;
   import flash.geom.Point;
   import flash.events.KeyboardEvent;
   import flash.events.MouseEvent;
   import flash.events.TimerEvent;
   import flash.net.URLLoader;
   import flash.net.URLRequest;
   import flash.text.Font;
   import flash.text.TextField;
   import flash.text.TextFormat;
   import flash.events.UncaughtErrorEvent;
   import flash.external.ExternalInterface;
   import flash.system.Capabilities;
   import flash.system.Security;
   import flash.system.System;
   import flash.ui.Mouse;
   import flash.utils.Dictionary;
   import flash.utils.Timer;
   import flash.utils.getTimer;
   import game.MinigameManager;
   import gamePlayFlow.GamePlay;
   import gskinner.motion.GTween;
   import gui.DarkenManager;
   import gui.GuiManager;
   import loadProgress.LoadProgress;
   import loader.DefPacksDefHelper;
   import localization.LocalizationManager;
   import resource.LoadAvatarCarouselResourceStackable;
   import resource.LoadCursorResourceStackable;
   import room.DebugGUITextbox;
   import room.RoomManagerWorld;
   import waitingRoomFlow.WaitingRoom;
   
   [SWF(width="900", height="550", backgroundColor="#393625", frameRate="24")]
   public class AJClient extends Sprite
   {
      
      private static var _globalDebugLog:DebugGUITextbox;
      
      private static var _toolsInstance:AJClient;
      
      private var _resourceStackLoader:ResourceStack;
      
      private var _finder:Sprite;
      
      private var _finderPanel:Sprite;
      
      private var _finderInputBar:MovieClip;
      
      private var _finderColourBar:MovieClip;
      
      private var _finderInput:TextField;
      
      private var _finderStatus:TextField;
      
      private var _finderPageLabel:TextField;
      
      private var _finderKindButton:MovieClip;
      
      private var _finderRows:Sprite;
      
      private var _finderResults:Array;
      
      private var _finderTotal:int;
      
      private var _finderPage:int;
      
      private var _finderKind:int;
      
      private var _finderColourInput:TextField;

      // the staff's window for one player (openModerate), and what the
      // signed-in role may do ("xsp" from the server; empty for players).
      private var _moderate:Sprite;

      private var _moderateContent:MovieClip;

      private var _moderateName:String;

      private var _moderateReason:int;

      private var _moderateMessageBar:MovieClip;

      private var _moderateButtons:Array;

      public static var staffRole:String = "";

      public static var staffPermissions:Array = [];
      
      // the items drawn on the rows shown, by row number
      private var _finderIcons:Object = {};
      
      // a hex colour typed, as a local colour id for the previews only
      // (PaletteHelper.customColors): the server makes the real one on Give
      private var _finderHexKey:String = "";
      
      private var _finderHexId:uint = 0;
      
      private var _finderHexCount:uint = 0;
      
      public function AJClient()
      {
         super();
         addEventListener("addedToStage",addedToStageHandler);
      }
      
      public static function get globalDebugLog() : DebugGUITextbox
      {
         return _globalDebugLog;
      }
      
      private function addedToStageHandler(param1:Event) : void
      {
         var _loc2_:Object = null;
         var _loc3_:int = 0;
         removeEventListener("addedToStage",addedToStageHandler);
         addEventListener("enterFrame",onSmoothFrame);
         try
         {
            if(ExternalInterface.available)
            {
               ExternalInterface.addCallback("ajHud",setHudShown);
            }
         }
         catch(e:Error)
         {
         }
         // the official client lets a SWF from any domain reach into it here
         // (Security.allowDomain("*")). on this server the page, the client
         // and every asset come from one address, so nothing needs that, and
         // a stranger's SWF that got itself loaded must not have it.
         var _loc4_:Boolean = ExternalInterface.available;
         if(_loc4_)
         {
            DebugUtility.debugTrace("addedToStageHandler - extIntAvail is true");
            DebugUtility.debugTrace("mrc dm init ctor starting up call returned:" + ExternalInterface.call("mrc",["dm","AJClient addedToStageHandler starting up"]));
            ExternalInterface.call("handleGAEvent","flashStarted");
         }
         else
         {
            DebugUtility.debugTrace("addedToStageHandler - extIntAvail is false");
         }
         if(!MainFrame.isInitialized())
         {
            if(parent != null)
            {
               if(parent.hasOwnProperty("flashVars"))
               {
                  _loc2_ = parent["flashVars"];
               }
               else
               {
                  _loc2_ = parent.loaderInfo.parameters;
               }
            }
            else
            {
               _loc2_ = loaderInfo.parameters;
            }
            DebugUtility.debugTrace("addedToStageHandler - printing loaderInfo parameters flashvars...");
            _loc3_ = 0;
            for(var _loc5_:String in _loc2_)
            {
               DebugUtility.debugTrace("  flashvar " + _loc5_ + ":" + _loc2_[_loc5_]);
               _loc3_++;
            }
            DebugUtility.debugTrace("addedToStageHandler - ...done printing loaderInfo parameters flashvars - i:" + _loc3_);
            MainFrame.handleLocalExternalCall = GamePlay.handleLocalExternalCall;
            MainFrame.getInstance(_loc2_,setupInit,"",this);
            LoadProgress.updateProgress(2);
            _globalDebugLog = new DebugGUITextbox(this,"","Debug Log [F4]",false,true,true,750,276,true);
            _globalDebugLog.x = 80;
            _globalDebugLog.y = 50;
            DebugUtility.setDebugGUIHandler(_globalDebugLog.appendHtml);
            loaderInfo.uncaughtErrorEvents.addEventListener("uncaughtError",handleGlobalErrors);
         }
         DebugUtility.debugTrace("AJClient addedToStageHandler finished");
      }
      
      public function setupInit() : void
      {
         gMainFrame.stage.addEventListener("Localization",LocalizationManager.onLocalizationEvent,false,0,true);
         LocalizationManager.currentLanguage = LocalizationManager.accountLanguage = LocalizationManager.getLanguageIdForLocale(gMainFrame.clientInfo.locale);
         LocalizationManager.countryCode = gMainFrame.clientInfo.countryCode;
         var _loc1_:DefPacksDefHelper = new DefPacksDefHelper();
         _loc1_.init(uint("1023" + LocalizationManager.currentLanguage),LocalizationXtCommManager.onLocalizationListResponse,loadResourceItems,2);
         DefPacksDefHelper.mediaArray["1023" + LocalizationManager.currentLanguage] = _loc1_;
         _loc1_ = new DefPacksDefHelper();
         _loc1_.init(uint("1055" + LocalizationManager.accountLanguage),LocalizationXtCommManager.onPreferredLocalizationListResponse,null,2);
         DefPacksDefHelper.mediaArray["1055" + LocalizationManager.accountLanguage] = _loc1_;
      }
      
      public function loadResourceItems() : void
      {
         LoadProgress.updateProgress(3);
         Utility.init(DarkenManager.showLoadingSpiral,DarkenManager.darken,DarkenManager.unDarken);
         _resourceStackLoader = new ResourceStack(gMainFrame.path,gMainFrame.loaderCache.openFile);
         _resourceStackLoader.pushFile("assets/sharedFonts.swf",true);
         _resourceStackLoader.pushFile("assets/HUDAssets.swf",true);
         if(gMainFrame.clientInfo.isCreateAccount)
         {
            _resourceStackLoader.pushClass(new LoadAvatarCarouselResourceStackable());
         }
         if(Mouse["supportsNativeCursor"])
         {
            _resourceStackLoader.pushClass(new LoadCursorResourceStackable());
         }
         if(ExternalInterface.available)
         {
            ExternalInterface.call("aj_initialized");
         }
         if("failedToInitiate" in gMainFrame.clientInfo && gMainFrame.clientInfo.failedToInitiate == true)
         {
            _resourceStackLoader.start(onInitiationFailure);
         }
         else if(gMainFrame.clientInfo.isCreateAccount)
         {
            _resourceStackLoader.start(setupCreateAccount);
         }
         else if(gMainFrame.clientInfo.waitingMode)
         {
            _resourceStackLoader.start(setupWaitingRoom);
         }
         else
         {
            _resourceStackLoader.start(setupGamePlay);
         }
      }
      
      public function setupCreateAccount() : void
      {
         var _loc1_:CreateAccount = new CreateAccount(gMainFrame.clientInfo);
         addChild(_loc1_);
         gMainFrame.createAccount = _loc1_;
         _loc1_.loginCtorHelper();
      }
      
      public function setupWaitingRoom() : void
      {
         var _loc1_:WaitingRoom = new WaitingRoom(gMainFrame.clientInfo);
         addChild(_loc1_);
         gMainFrame.waitingRoom = _loc1_;
         _loc1_.waitCtorHelper();
      }
      
      public function setupGamePlay(param1:Event = null, param2:Event = null) : void
      {
         DebugUtility.debugTrace("setupGamePlay - loginEvt:" + param1 + " connectEvt:" + param2);
         if(gMainFrame.createAccount)
         {
            if(contains(gMainFrame.createAccount))
            {
               removeChild(gMainFrame.createAccount);
            }
            gMainFrame.createAccount = null;
            _resourceStackLoader = null;
         }
         DebugUtility.debugTrace("setupGamePlay - constructing GamePlay - gMainFrame.clientInfo:" + gMainFrame.clientInfo);
         var _loc3_:GamePlay = new GamePlay(gMainFrame.clientInfo,param1,param2);
         addChild(_loc3_);
         gMainFrame.gamePlay = _loc3_;
         DebugUtility.debugTrace("setupGamePlay - gp:" + _loc3_ + " calling worldCtorHelper");
         _loc3_.worldCtorHelper();
         setupItemFinder();
      }
      
      private function setupItemFinder() : void
      {
         if(_toolsInstance != null)
         {
            return;
         }
         _toolsInstance = this;
         _finderResults = [];
         try
         {
            loadFilterLists();
         }
         catch(e:Error)
         {
            GlobalErrorCatch.reportToServer("chat filter: " + e);
         }
         gMainFrame.stage.addEventListener("keyDown",onFinderKey,true,1000);
         gMainFrame.stage.addEventListener("keyDown",onFinderKey,false,1000);
      }
      
      public static function openTool(param1:int) : void
      {
         if(_toolsInstance == null)
         {
            return;
         }
         try
         {
            if(param1 == 1)
            {
               _toolsInstance.showChatFilter(true);
            }
            else
            {
               _toolsInstance.showItemFinder(true);
            }
         }
         catch(e:Error)
         {
            GlobalErrorCatch.reportToServer((param1 == 1 ? "chat filter: " : "item giver: ") + e + "\n" + e.getStackTrace());
         }
      }
      
      // when a player was last seen, for their card: param1 is the time in
      // seconds the server sends in place of "days since last login".
      // "12:13 (1 hour ago)" within a day, "10:45 October 10 (1 day ago)"
      // within thirty, "8:44 January 1 2026" beyond. in this computer's
      // time zone.
      public static function lastSeenText(param1:int) : String
      {
         var _loc2_:Array = ["January","February","March","April","May","June","July","August","September","October","November","December"];
         var _loc3_:Date = new Date(param1 * 1000);
         var _loc4_:Number = Math.max(0,Math.floor((new Date().time - _loc3_.time) / 60000));
         var _loc5_:int = int(_loc4_ / 60);
         var _loc6_:int = int(_loc4_ / 1440);
         var _loc7_:String = _loc3_.hours + ":" + (_loc3_.minutes < 10 ? "0" : "") + _loc3_.minutes;
         if(_loc6_ >= 30)
         {
            return _loc7_ + " " + _loc2_[_loc3_.month] + " " + _loc3_.date + " " + _loc3_.fullYear;
         }
         if(_loc6_ >= 1)
         {
            return _loc7_ + " " + _loc2_[_loc3_.month] + " " + _loc3_.date + " (" + _loc6_ + (_loc6_ == 1 ? " day ago)" : " days ago)");
         }
         if(_loc5_ >= 1)
         {
            return _loc7_ + " (" + _loc5_ + (_loc5_ == 1 ? " hour ago)" : " hours ago)");
         }
         if(_loc4_ >= 1)
         {
            return _loc7_ + " (" + _loc4_ + (_loc4_ == 1 ? " minute ago)" : " minutes ago)");
         }
         return _loc7_ + " (just now)";
      }
      
      public static function setTheme(param1:String) : void
      {
         var _loc2_:URLRequest = new URLRequest(gMainFrame.clientInfo.websiteURL + "api/theme");
         _loc2_.method = "POST";
         _loc2_.contentType = "application/json";
         _loc2_.data = JSON.stringify({
            "username":gMainFrame.server.userName,
            "token":gMainFrame.clientInfo.authToken,
            "theme":param1
         });
         var _loc3_:URLLoader = new URLLoader();
         _loc3_.addEventListener("ioError",onThemeFailed);
         _loc3_.addEventListener("securityError",onThemeFailed);
         _loc3_.load(_loc2_);
      }
      
      // " (have 2)" after the name of a shop item the player owns already.
      public static function ownedSuffix(param1:Object) : String
      {
         var _loc2_:int = 0;
         var _loc3_:int = 0;
         var _loc4_:Object = null;
         try
         {
            if(param1 is Item)
            {
               _loc4_ = gMainFrame.userInfo.playerAvatarInfo.getFullItems();
               while(_loc3_ < _loc4_.length)
               {
                  if(_loc4_.getAccItem(_loc3_).defId == param1.defId)
                  {
                     _loc2_++;
                  }
                  _loc3_++;
               }
            }
            else if(param1 is DenItem)
            {
               _loc4_ = AvatarManager.playerAvatar.inventoryDenFull.denItemCollection;
               while(_loc3_ < _loc4_.length)
               {
                  if(_loc4_.getDenItem(_loc3_).defId == param1.defId)
                  {
                     _loc2_++;
                  }
                  _loc3_++;
               }
            }
         }
         catch(e:Error)
         {
            return "";
         }
         return _loc2_ > 0 ? " (have " + _loc2_ + ")" : "";
      }
      
      // "xls" from the server: when each offline buddy was last seen, for
      // the buddy list's rows. [.., .., count, (username, seconds)...]
      private static var _lastSeen:Object = {};
      
      public static function noteLastSeen(param1:Object) : void
      {
         var _loc2_:int = int(param1[2]);
         var _loc3_:int = 0;
         _lastSeen = {};
         while(_loc3_ < _loc2_)
         {
            _lastSeen[String(param1[3 + _loc3_ * 2]).toLowerCase()] = int(param1[4 + _loc3_ * 2]);
            _loc3_++;
         }
      }
      
      // " (5m)", " (3h)", " (12d)", " (Jan 2025)" after an offline buddy's
      // name; nothing when it is not known.
      public static function lastSeenShort(param1:String) : String
      {
         var _loc2_:Array = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
         var _loc3_:int = int(_lastSeen[param1.toLowerCase()]);
         var _loc4_:Date = new Date(_loc3_ * 1000);
         var _loc5_:Number = Math.max(0,Math.floor((new Date().time - _loc4_.time) / 60000));
         if(_loc3_ < 100000)
         {
            return "";
         }
         if(_loc5_ < 60)
         {
            return " (" + Math.max(1,_loc5_) + "m)";
         }
         if(_loc5_ < 1440)
         {
            return " (" + int(_loc5_ / 60) + "h)";
         }
         if(_loc5_ < 43200)
         {
            return " (" + int(_loc5_ / 1440) + "d)";
         }
         return " (" + _loc2_[_loc4_.month] + " " + _loc4_.fullYear + ")";
      }
      
      // "Joined Oct 2026", for the label on a player's card.
      public static function joinedText(param1:int) : String
      {
         var _loc2_:Array = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
         var _loc3_:Date = new Date(param1 * 1000);
         return param1 > 100000 ? "Joined " + _loc2_[_loc3_.month] + " " + _loc3_.fullYear : "";
      }
      
      // is the game's own font there to be used in a text field made here?
      public static function hasGameFont() : Boolean
      {
         for each(var _loc1_:Font in Font.enumerateFonts(false))
         {
            if(_loc1_.fontName == "CCDigitalDelivery")
            {
               return true;
            }
         }
         return false;
      }
      
      // an oval label: white text in the game's font on a colour, with a
      // darker edge, and room on the left for an icon when param4 is set.
      // used for "Banned" and "Joined" on player cards and for buttons the
      // artwork has none for.
      public static function makePill(param1:String, param2:uint, param3:uint, param4:Boolean = false, param5:int = 12) : Sprite
      {
         var _loc6_:Sprite = new Sprite();
         var _loc7_:TextField = new TextField();
         var _loc8_:int = param5 + 10;
         var _loc9_:Number = 0;
         _loc7_.embedFonts = hasGameFont();
         _loc7_.selectable = false;
         _loc7_.mouseEnabled = false;
         _loc7_.autoSize = "left";
         _loc7_.defaultTextFormat = new TextFormat("CCDigitalDelivery",param5,16777215,true);
         _loc7_.text = param1;
         _loc7_.name = "txt";
         _loc7_.x = param4 ? _loc8_ + 6 : 10;
         _loc7_.y = int((_loc8_ - _loc7_.height) * 0.5);
         _loc9_ = _loc7_.x + _loc7_.width + 9;
         _loc6_.graphics.lineStyle(2,param3);
         _loc6_.graphics.beginFill(param2);
         _loc6_.graphics.drawRoundRect(0,0,_loc9_,_loc8_,_loc8_,_loc8_);
         _loc6_.graphics.endFill();
         _loc6_.addChild(_loc7_);
         _loc6_.mouseChildren = false;
         return _loc6_;
      }
      
      // "xdi": [.., .., kind, rows as JSON]. items the staff made while the
      // game runs (the server's lib/customitems.js): "clothing" or "den" def
      // rows, as in the item packs, each with its name.
      public static function onItemDefs(param1:Object) : void
      {
         try
         {
            var _loc2_:Array = JSON.parse(String(param1[3])) as Array;
            if(String(param1[2]) == "den")
            {
               DenXtCommManager.addDenItemDefs(_loc2_);
            }
            else
            {
               ItemXtCommManager.addItemDefs(_loc2_);
            }
         }
         catch(e:Error)
         {
            GlobalErrorCatch.reportToServer("item defs: " + e + "\n" + e.getStackTrace());
         }
      }

      // "xsp": [.., .., role, permissions]. sent at login to staff only: their
      // role and what it allows, comma separated (the server's lib/roles.js).
      public static function onStaff(param1:Object) : void
      {
         staffRole = String(param1[2]);
         staffPermissions = String(param1[3]).length > 0 ? String(param1[3]).split(",") : [];
      }

      public static function staffMay(param1:String) : Boolean
      {
         return staffPermissions.indexOf(param1) != -1;
      }

      // whether a player's card offers the staff's window instead of a report.
      public static function canModerate() : Boolean
      {
         return _toolsInstance != null && (staffMay("player.warn") || staffMay("player.kick") || staffMay("chat.silence") || staffMay("player.summon") || staffMay("player.goto"));
      }

      public static function openModerate(param1:String) : void
      {
         if(_toolsInstance == null)
         {
            return;
         }
         try
         {
            _toolsInstance.showModerate(param1);
         }
         catch(e:Error)
         {
            GlobalErrorCatch.reportToServer("moderate: " + e + "\n" + e.getStackTrace());
         }
      }

      // "xtl": [.., .., text]. A plain message box; what a chat command says.
      public static function showMessage(param1:Object) : void
      {
         new SBOkPopup(GuiManager.guiLayer,String(param1[2]));
      }
      
      // "xyn": [.., .., id, text]. A yes-or-no box; the answer goes back as
      // "xyn" [id, 1 | 0].
      public static function askYesNo(param1:Object) : void
      {
         new SBYesNoPopup(GuiManager.guiLayer,String(param1[3]),true,onYesNo,int(param1[2]));
      }
      
      private static function onYesNo(param1:Object) : void
      {
         gMainFrame.server.setXtObject_Str("xyn",[param1.passback,param1.status ? 1 : 0]);
      }
      
      // "xw": a whisper. [.., .., 1]: the chat line that follows is one, and
      // its bubble is drawn light green (gui.ChatBalloon reads whisperNext).
      // [.., .., 0, from, text]: from another room, so a message box, in
      // the same green.
      public static var whisperNext:Boolean = false;
      
      public static function onWhisper(param1:Object) : void
      {
         var _loc2_:SBOkPopup = null;
         if(String(param1[2]) == "1")
         {
            whisperNext = true;
            return;
         }
         // through the reader's chat filter, as a bubble would be.
         var _loc3_:String = filterText(String(param1[4]));
         if(_loc3_ == null)
         {
            return;
         }
         _loc2_ = new SBOkPopup(GuiManager.guiLayer,String(param1[3]) + " whispers:\n" + _loc3_);
         _loc2_.transform.colorTransform = whisperTint();
      }
      
      public static function whisperTint() : ColorTransform
      {
         return new ColorTransform(0.72,1,0.72,1,0,18,0,0);
      }
      
      private static var _renaming:Dictionary = new Dictionary(true);
      
      private static var _renameField:TextField;
      
      private static var _renameOld:String;
      
      private static var _renameHosts:Dictionary = new Dictionary(true);
      
      private static var _nameDownField:TextField;
      
      private static var _nameDownAt:int;
      
      // makes a name's text field one that a double click turns into a box
      // to type in. param2 is "a" or "p", param3 the animal's perUserAvId or
      // the pet's inventory id; param4, if given, is told the new name once
      // the server has taken it. param5 is what hears the mouse there (the
      // cell or window the name is drawn in: the artwork's text fields hear
      // nothing themselves), so the presses are caught on it, ahead of its
      // own listeners, and those on the name are kept from them.
      public static function makeRenamable(param1:TextField, param2:String, param3:int, param4:Function, param5:DisplayObject) : void
      {
         if(param1 == null || param5 == null)
         {
            return;
         }
         _renaming[param1] = {
            "kind":param2,
            "id":param3,
            "done":param4
         };
         _renameHosts[param5] = param1;
         param5.addEventListener("mouseDown",onRenameHostDown,true,1000,true);
         param5.addEventListener("mouseDown",onRenameHostDown,false,1000,true);
      }
      
      private static function onRenameHostDown(param1:MouseEvent) : void
      {
         var _loc2_:TextField = _renameHosts[param1.currentTarget];
         var _loc3_:int = getTimer();
         if(_loc2_ == null || _loc2_.stage == null || _renaming[_loc2_] == null)
         {
            return;
         }
         if(!_loc2_.getBounds(_loc2_.stage).contains(param1.stageX,param1.stageY))
         {
            if(_renameField == _loc2_)
            {
               endRename(true);
            }
            return;
         }
         param1.stopImmediatePropagation();
         if(_renameField != null)
         {
            return;
         }
         if(_nameDownField == _loc2_ && _loc3_ - _nameDownAt < 500)
         {
            _nameDownField = null;
            startRename(_loc2_);
            return;
         }
         _nameDownField = _loc2_;
         _nameDownAt = _loc3_;
      }
      
      private static function startRename(param1:TextField) : void
      {
         _renameField = param1;
         _renameOld = param1.text;
         param1.type = "input";
         param1.selectable = true;
         param1.mouseEnabled = true;
         param1.maxChars = 20;
         param1.restrict = "A-Za-z0-9 '.\\-";
         param1.addEventListener("keyDown",onRenameKey,false,0,true);
         param1.addEventListener("focusOut",onRenameFocusOut,false,0,true);
         gMainFrame.stage.focus = param1;
         param1.setSelection(0,param1.text.length);
      }
      
      private static function onRenameKey(param1:KeyboardEvent) : void
      {
         param1.stopPropagation();
         if(param1.keyCode == 13)
         {
            endRename(true);
         }
         else if(param1.keyCode == 27)
         {
            endRename(false);
         }
      }
      
      private static function onRenameFocusOut(param1:Event) : void
      {
         endRename(true);
      }
      
      private static function endRename(param1:Boolean) : void
      {
         var _loc2_:TextField = _renameField;
         var _loc3_:Object = null;
         var _loc4_:String = null;
         if(_loc2_ == null)
         {
            return;
         }
         _renameField = null;
         _loc3_ = _renaming[_loc2_];
         _loc4_ = _loc2_.text.replace(/^\s+|\s+$/g,"");
         _loc2_.removeEventListener("keyDown",onRenameKey);
         _loc2_.removeEventListener("focusOut",onRenameFocusOut);
         _loc2_.type = "dynamic";
         _loc2_.selectable = false;
         _loc2_.setSelection(0,0);
         if(gMainFrame.stage.focus == _loc2_)
         {
            gMainFrame.stage.focus = null;
         }
         if(!param1 || _loc3_ == null || _loc4_.length == 0 || _loc4_ == _renameOld)
         {
            _loc2_.text = _renameOld;
            return;
         }
         _loc2_.text = _loc4_;
         _loc3_.old = _renameOld;
         _loc3_.field = _loc2_;
         _pendingRenames[_loc3_.kind + ":" + _loc3_.id] = _loc3_;
         gMainFrame.server.setXtObject_Str("xrn",[_loc3_.kind,_loc3_.id,_loc4_]);
      }
      
      private static var _pendingRenames:Object = {};
      
      // "xrn": [.., .., kind, id, 1 | 0, the name as it now is]
      public static function onRenamed(param1:Object) : void
      {
         var _loc2_:String = String(param1[2]) + ":" + String(param1[3]);
         var _loc3_:Object = _pendingRenames[_loc2_];
         delete _pendingRenames[_loc2_];
         if(_loc3_ == null)
         {
            return;
         }
         if(String(param1[4]) != "1")
         {
            _loc3_.field.text = _loc3_.old;
            new SBOkPopup(GuiManager.guiLayer,"Names are letters, digits and spaces, up to 20 long.");
         }
         else if(_loc3_.done != null)
         {
            _loc3_.done(String(param1[5]));
         }
      }
      
      // ---- items picked several at a time (the item picker, recycling)
      //
      // which items are picked, by kind and inventory id. an item cell
      // (gui.itemWindows.ItemWindowOriginal) draws its green ring from this,
      // so a pick stays shown through scrolling, tabs and searches.
      private static var _picked:Object = {};
      
      public static var pickedCount:int = 0;
      
      public static function pickKey(param1:Object) : String
      {
         return (param1 is Item ? "c" : (param1 is DenItem ? "d" : "p")) + param1.invIdx;
      }
      
      public static function isPicked(param1:Object) : Boolean
      {
         return param1 != null && _picked[pickKey(param1)] != null;
      }
      
      public static function setPicked(param1:Object, param2:Boolean) : void
      {
         var _loc3_:String = pickKey(param1);
         if(param2 && _picked[_loc3_] == null)
         {
            _picked[_loc3_] = param1;
            pickedCount++;
         }
         else if(!param2 && _picked[_loc3_] != null)
         {
            delete _picked[_loc3_];
            pickedCount--;
         }
      }
      
      public static function pickedItems() : Array
      {
         var _loc1_:Array = [];
         for each(var _loc2_:Object in _picked)
         {
            _loc1_.push(_loc2_);
         }
         return _loc1_;
      }
      
      public static function clearPicked() : void
      {
         _picked = {};
         pickedCount = 0;
      }
      
      // ---- the HUD shown or not, from the client's top bar (ajHud in the
      // game's page calls setHudShown). the game shows its HUD again by
      // itself on the way into a room, so while it is to be hidden it is
      // hidden again every frame (onSmoothFrame).
      
      private static var _hudHidden:Boolean;
      
      private static function setHudShown(param1:Boolean) : void
      {
         _hudHidden = !param1;
         try
         {
            if(GuiManager.mainHud == null)
            {
               return;
            }
            if(_hudHidden)
            {
               GuiManager.mainHud.visible = false;
               gMainFrame.stage.focus = null;
            }
            else if(!AvatarManager.isMyAvtInPreviewRoom && !MinigameManager.inMinigame())
            {
               // where the game keeps it hidden itself, it stays so.
               GuiManager.mainHud.visible = true;
            }
         }
         catch(e:Error)
         {
         }
      }
      
      // ---- smooth graphics, and the settings behind it
      //
      // the game draws 24 pictures a second and moves everything once a
      // picture. with "Graphics: Smooth" what the game moves by the clock is
      // also moved between two pictures and the screen drawn again each
      // time: animals that are walking, the camera, and the windows and tabs
      // that slide (GTween). the drawing quality is "high" where the game
      // keeps "medium", and a click or a key is acted on at once. the 24
      // frames themselves are left alone, so nothing that counts frames
      // (animations, the rooms' own artwork, minigames) runs any faster; in
      // a minigame all of this is off.
      //
      // the settings, user vars of this server's own, in the settings menu
      // (gui.itemWindows.ItemWindowToggle):
      //   9003  Graphics: 1 Default (the game as it was: all of it off; not
      //         called "Performance", since it is little lighter on any but
      //         the weakest machine), 2 Smooth; unset is
      //         the server's default (config.smooth: it sends 1 or nothing).
      //   9004  Frame rate: 1 is 60; anything else is Max, as fast as the
      //         timer goes (about 80 a second on the owner's machine, where
      //         the 120 and 144 this once offered came to the same).
      //   9005  Camera: 1 Smooth (room.RoomManagerWorld.easeCamera), else the
      //         game's own.
      
      
      private static var _smoothTimer:Timer;
      
      private static var _smoothAt:int; // when things were last moved, by a frame or between two
      
      private static var _smoothQuality:Boolean; // the quality is ours at the moment
      
      private static var _smoothBroken:Boolean; // it threw three times: off until the game is started again
      
      private static var _smoothErrors:int;
      
      private static var _drawn:int; // pictures since the count was last told
      
      private static var _drawnSince:int;
      
      private static function settingOf(param1:int) : int
      {
         return int(gMainFrame.userInfo.userVarCache.getUserVarValueById(param1));
      }
      
      public static function smoothOn() : Boolean
      {
         return settingOf(9003) != 1;
      }
      
      // pictures a second asked for, or 0 for no limit.
      public static function frameRate() : int
      {
         return settingOf(9004) == 1 ? 60 : 0;
      }
      
      public static function cameraEases() : Boolean
      {
         var _loc1_:Boolean = false;
         try
         {
            _loc1_ = smoothOn() && settingOf(9005) == 1;
         }
         catch(e:Error)
         {
         }
         return _loc1_;
      }
      
      // every frame: whether the extra steps should be running just now, and
      // once a second how many pictures were drawn, for the client's top bar
      // (ajFps in the game's page).
      private function onSmoothFrame(param1:Event) : void
      {
         var _loc2_:Boolean = false;
         var _loc3_:int = getTimer();
         var _loc4_:int = 0;
         _smoothAt = _loc3_;
         _drawn++;
         if(_hudHidden && GuiManager.mainHud != null && GuiManager.mainHud.visible)
         {
            GuiManager.mainHud.visible = false;
         }
         if(_loc3_ - _drawnSince >= 1000)
         {
            try
            {
               if(ExternalInterface.available)
               {
                  ExternalInterface.call("ajFps",Math.round(_drawn * 1000 / (_loc3_ - _drawnSince)));
               }
            }
            catch(e:Error)
            {
            }
            _drawn = 0;
            _drawnSince = _loc3_;
         }
         try
         {
            _loc2_ = !_smoothBroken && MainFrame.isInitialized() && gMainFrame.userInfo != null && gMainFrame.userInfo.userVarCache != null && AvatarManager.playerAvatarWorldView != null && !MinigameManager.inMinigame() && smoothOn();
         }
         catch(e:Error)
         {
            _loc2_ = false;
         }
         if(_loc2_)
         {
            _loc4_ = frameRate() > 0 ? Math.round(1000 / frameRate()) : 1;
            if(_smoothTimer == null)
            {
               _smoothTimer = new Timer(_loc4_);
               _smoothTimer.addEventListener("timer",onSmoothTimer);
            }
            if(_smoothTimer.delay != _loc4_)
            {
               _smoothTimer.delay = _loc4_;
            }
            if(!_smoothTimer.running)
            {
               _smoothTimer.start();
            }
            if(gMainFrame.stage.quality != "HIGH")
            {
               gMainFrame.stage.quality = "high";
            }
            _smoothQuality = true;
         }
         else
         {
            if(_smoothTimer != null && _smoothTimer.running)
            {
               _smoothTimer.stop();
            }
            if(_smoothQuality)
            {
               _smoothQuality = false;
               gMainFrame.stage.quality = gMainFrame.currStageQuality != null ? gMainFrame.currStageQuality : "medium";
            }
         }
      }
      
      // between two frames: every animal that is walking goes on by the
      // time since it last moved, the camera follows the player's, sliding
      // windows slide on, and if any of that moved the screen is drawn.
      private static function onSmoothTimer(param1:TimerEvent) : void
      {
         var _loc2_:int = getTimer();
         var _loc3_:int = _loc2_ - _smoothAt;
         var _loc4_:Object = null;
         var _loc5_:AvatarWorldView = null;
         var _loc6_:Boolean = false;
         // too soon after the last step for the rate asked for, or a pause
         // too long to be a step.
         if(_loc3_ < 1 || _loc3_ * 2 < _smoothTimer.delay || _loc3_ > 100)
         {
            return;
         }
         try
         {
            _loc4_ = AvatarManager.avatarViewList;
            for each(_loc5_ in _loc4_)
            {
               if(_loc5_ != null && _loc5_.glide(_loc3_))
               {
                  _loc6_ = true;
               }
            }
            _smoothAt = _loc2_;
            if(RoomManagerWorld.instance.glideCamera(_loc3_))
            {
               _loc6_ = true;
            }
            if(GTween.tickNow())
            {
               _loc6_ = true;
            }
            if(_loc6_)
            {
               _drawn++;
               param1.updateAfterEvent();
            }
         }
         catch(e:Error)
         {
            // #1502, "a script ran too long", is not this code's: the game
            // gets it now and then whatever is running (it is in the notes
            // as a known problem), and one step lost to it is nothing.
            // anything else three times and it is this code that is wrong.
            if(e.errorID != 1502)
            {
               _smoothErrors++;
               if(_smoothErrors >= 3)
               {
                  _smoothBroken = true;
                  _smoothTimer.stop();
                  GlobalErrorCatch.reportToServer("smooth graphics stopped: " + e + "\n" + e.getStackTrace());
               }
            }
         }
      }
      
      public static function wasdOn() : Boolean
      {
         return gMainFrame.userInfo.userVarCache.getUserVarValueById(9002) == 1;
      }
      
      // the arrow key a key stands for: itself, or with the setting on and
      // nothing being typed, the arrow W, A, S or D stands for.
      public static function moveKey(param1:int) : int
      {
         if(param1 < 65 || param1 > 87 || gMainFrame.stage.focus is TextField || !wasdOn())
         {
            return param1;
         }
         switch(param1)
         {
            case 87:
               return 38;
            case 65:
               return 37;
            case 83:
               return 40;
            case 68:
               return 39;
         }
         return param1;
      }
      
      // A short list of words to pick from, drawn here: the game's sort
      // menu was pictures. param1 the words, param2 is told the one picked
      // (its place in the list), param3 the one to mark as the current one.
      public static function makeTextMenu(param1:Array, param2:Function, param3:int = -1) : Sprite
      {
         var _loc4_:Sprite = new Sprite();
         var _loc5_:int = 0;
         var _loc6_:Sprite = null;
         var _loc7_:TextField = null;
         var _loc8_:int = 78;
         var _loc9_:int = 19;
         // one panel in the inventory's colours, a row of it per word.
         _loc4_.graphics.lineStyle(2,8349508);
         _loc4_.graphics.beginFill(16774084);
         _loc4_.graphics.drawRoundRect(0,0,_loc8_ + 8,param1.length * _loc9_ + 8,14,14);
         _loc4_.graphics.endFill();
         while(_loc5_ < param1.length)
         {
            _loc6_ = new Sprite();
            _loc6_.graphics.beginFill(3184463,_loc5_ == param3 ? 1 : 0);
            _loc6_.graphics.drawRoundRect(0,0,_loc8_,_loc9_ - 1,10,10);
            _loc6_.graphics.endFill();
            _loc7_ = new TextField();
            _loc7_.embedFonts = hasGameFont();
            _loc7_.selectable = false;
            _loc7_.autoSize = "left";
            _loc7_.defaultTextFormat = new TextFormat("CCDigitalDelivery",12,_loc5_ == param3 ? 16777215 : 6045213,true);
            _loc7_.text = param1[_loc5_];
            _loc7_.x = 8;
            _loc7_.y = int((_loc9_ - 1 - _loc7_.height) * 0.5);
            _loc6_.addChild(_loc7_);
            _loc6_.x = 4;
            _loc6_.y = 4 + _loc5_ * _loc9_;
            _loc6_.name = "pick" + _loc5_;
            _loc6_.buttonMode = true;
            _loc6_.mouseChildren = false;
            _loc6_.addEventListener("mouseDown",onTextMenuPick,false,0,false);
            _loc4_.addChild(_loc6_);
            _loc5_++;
         }
         _textMenuCallbacks[_loc4_] = param2;
         return _loc4_;
      }
      
      private static var _textMenuCallbacks:Dictionary = new Dictionary(true);
      
      private static function onTextMenuPick(param1:MouseEvent) : void
      {
         var _loc2_:Sprite = param1.currentTarget as Sprite;
         var _loc3_:Function = _textMenuCallbacks[_loc2_.parent];
         param1.stopPropagation();
         if(_loc3_ != null)
         {
            _loc3_(int(_loc2_.name.substr(4)));
         }
      }
      
      // runs one of the chat commands the settings menu's Outfits and Den
      // layouts lists stand for (the server takes only those).
      public static function runCommand(param1:String) : void
      {
         var _loc2_:URLRequest = new URLRequest(gMainFrame.clientInfo.websiteURL + "api/command");
         _loc2_.method = "POST";
         _loc2_.contentType = "application/json";
         _loc2_.data = JSON.stringify({
            "username":gMainFrame.server.userName,
            "token":gMainFrame.clientInfo.authToken,
            "text":param1
         });
         var _loc3_:URLLoader = new URLLoader();
         _loc3_.addEventListener("ioError",onThemeFailed);
         _loc3_.addEventListener("securityError",onThemeFailed);
         _loc3_.load(_loc2_);
      }
      
      private static function onThemeFailed(param1:Event) : void
      {
         GlobalErrorCatch.reportToServer("theme change failed: " + param1);
      }
      
      // ---- the chat filter
      //
      // what other players wrote is filtered here, in each player's own
      // game, as that player chose: the server passes chat on as it was
      // typed. three levels (filterLevel): 0 nothing, which is where an
      // account starts, 1 keeps out extreme threats and common slurs, 2
      // swearing as well; and whatever words the
      // player listed themselves (filterOwn) at any level. two ways
      // (filterMode): 0 puts stars over a filtered word, 1 leaves the
      // whole message out. the words of levels 1 and 2 are two files on
      // the server (public/filter/level1.txt, level2.txt), fetched as the
      // game starts; the choice is kept with the account ("xfl").
      //
      // A word is matched whole, never inside another. digits and signs
      // standing in for letters are read as the letters, and a word with a
      // letter drawn out ("heeello") is matched as if it were not.
      public static var filterLevel:int = 0;
      
      public static var filterMode:int = 0;
      
      public static var filterOwn:String = "";
      
      public static var filterChosen:Boolean = true;
      
      public static var FILTER_HIDDEN:String = "(hidden by your chat filter)";
      
      private static var _filterLists:Array = [[],[]];
      
      private static var _filterOwnEntries:Array = [];
      
      private static var _filterLoaders:Array = [];
      
      private static function filterPlain(param1:String) : String
      {
         var _loc2_:String = param1.toLowerCase().replace(/^[0-9]+|[0-9]+$/g,"");
         _loc2_ = _loc2_.replace(/[@4]/g,"a").replace(/[$5]/g,"s").replace(/0/g,"o").replace(/1/g,"i").replace(/3/g,"e").replace(/7/g,"t");
         return _loc2_.replace(/[^a-z]/g,"");
      }
      
      private static function filterSquash(param1:String) : String
      {
         return param1.replace(/(.)\1+/g,"$1");
      }
      
      // the entries of a word list: a line is a word or a phrase, "#" starts
      // a note, and a "*" at the end stands for "and longer words that
      // start so". each entry: {t the words made plain, n how many words,
      // p whether it had the star, q the same with drawn-out letters undone}.
      private static function filterEntries(param1:String) : Array
      {
         var _loc2_:Array = [];
         var _loc3_:Array = param1.split(/\r\n|\r|\n|,/);
         var _loc4_:int = 0;
         var _loc5_:String = null;
         var _loc6_:Boolean = false;
         var _loc7_:Array = null;
         var _loc8_:Array = null;
         var _loc9_:int = 0;
         var _loc10_:String = null;
         while(_loc4_ < _loc3_.length)
         {
            _loc5_ = String(_loc3_[_loc4_]).replace(/^\s+|\s+$/g,"");
            _loc4_++;
            if(_loc5_.length == 0 || _loc5_.charAt(0) == "#")
            {
               continue;
            }
            _loc6_ = _loc5_.charAt(_loc5_.length - 1) == "*";
            _loc7_ = _loc5_.split(/\s+/);
            _loc8_ = [];
            _loc9_ = 0;
            while(_loc9_ < _loc7_.length)
            {
               _loc10_ = filterPlain(String(_loc7_[_loc9_]));
               if(_loc10_.length > 0)
               {
                  _loc8_.push(_loc10_);
               }
               _loc9_++;
            }
            if(_loc8_.length > 0 && _loc8_.join("").length >= 2)
            {
               _loc2_.push({
                  "t":_loc8_.join(" "),
                  "n":_loc8_.length,
                  "p":_loc6_,
                  "q":filterSquash(_loc8_.join(" "))
               });
            }
         }
         return _loc2_;
      }
      
      private static function loadFilterLists() : void
      {
         var _loc1_:int = 0;
         var _loc2_:URLLoader = null;
         while(_loc1_ < 2)
         {
            _loc2_ = new URLLoader();
            _loc2_.addEventListener("complete",onFilterListLoaded);
            _loc2_.addEventListener("ioError",onFilterListFailed);
            _loc2_.addEventListener("securityError",onFilterListFailed);
            _filterLoaders[_loc1_] = _loc2_;
            _loc2_.load(new URLRequest(gMainFrame.clientInfo.websiteURL + "filter/level" + (_loc1_ + 1) + ".txt"));
            _loc1_++;
         }
      }
      
      private static function onFilterListLoaded(param1:Event) : void
      {
         var _loc2_:int = _filterLoaders.indexOf(param1.target);
         if(_loc2_ >= 0)
         {
            _filterLists[_loc2_] = filterEntries(String(URLLoader(param1.target).data));
         }
      }
      
      private static function onFilterListFailed(param1:Event) : void
      {
         GlobalErrorCatch.reportToServer("chat filter: a word list did not load: " + param1);
      }
      
      // "xfl": [.., .., chosen, level, mode, own words]. the account's
      // choice, at login and after each change.
      public static function onFilterState(param1:Object) : void
      {
         filterChosen = String(param1[2]) == "1";
         filterLevel = int(param1[3]);
         filterMode = int(param1[4]);
         filterOwn = param1[5] == null ? "" : String(param1[5]);
         _filterOwnEntries = filterEntries(filterOwn);
      }
      
      // "xfa": the account has never chosen; the rules are put to it first,
      // then the window.
      public static function onFilterAsk(param1:Object) : void
      {
         openRules(function():void
         {
            openTool(1);
         });
      }
      
      // is the word at `param2` of the plain words `param1` (and those after
      // it, for a phrase) the entry `param3`?
      private static function filterHit(param1:Array, param2:int, param3:Object) : Boolean
      {
         var _loc4_:String = null;
         var _loc5_:String = null;
         if(param3.n > 1)
         {
            return param2 + param3.n <= param1.length && param1.slice(param2,param2 + param3.n).join(" ") == param3.t;
         }
         _loc4_ = param1[param2];
         if(_loc4_ == param3.t || param3.p && _loc4_.indexOf(param3.t) == 0)
         {
            return true;
         }
         if(/(.)\1\1/.test(_loc4_))
         {
            _loc5_ = filterSquash(_loc4_);
            return _loc5_ == param3.q || param3.p && _loc5_.indexOf(param3.q) == 0;
         }
         return false;
      }
      
      // what the player is to see of something another player wrote: the
      // text as it was, the text with stars over the filtered words, or
      // null when it is to be left out altogether.
      public static function filterText(param1:String) : String
      {
         var _loc2_:Array = _filterOwnEntries;
         var _loc3_:Array = [];
         var _loc4_:Array = [];
         var _loc5_:Array = [];
         var _loc6_:RegExp = /[A-Za-z0-9@$]+/g;
         var _loc7_:Object = null;
         var _loc8_:String = null;
         var _loc9_:int = 0;
         var _loc10_:int = 0;
         var _loc11_:int = 0;
         var _loc12_:Array = null;
         var _loc13_:Boolean = false;
         if(param1 == null || param1.length == 0)
         {
            return param1;
         }
         if(filterLevel >= 1)
         {
            _loc2_ = _loc2_.concat(_filterLists[0]);
         }
         if(filterLevel >= 2)
         {
            _loc2_ = _loc2_.concat(_filterLists[1]);
         }
         if(_loc2_.length == 0)
         {
            return param1;
         }
         _loc7_ = _loc6_.exec(param1);
         while(_loc7_ != null)
         {
            _loc8_ = filterPlain(String(_loc7_[0]));
            if(_loc8_.length > 0)
            {
               _loc3_.push(_loc8_);
               _loc4_.push(int(_loc7_.index));
               _loc5_.push(int(_loc7_.index) + String(_loc7_[0]).length);
            }
            _loc7_ = _loc6_.exec(param1);
         }
         _loc12_ = param1.split("");
         _loc9_ = 0;
         while(_loc9_ < _loc3_.length)
         {
            _loc10_ = 0;
            while(_loc10_ < _loc2_.length)
            {
               if(filterHit(_loc3_,_loc9_,_loc2_[_loc10_]))
               {
                  _loc13_ = true;
                  _loc11_ = _loc4_[_loc9_];
                  while(_loc11_ < _loc5_[_loc9_ + _loc2_[_loc10_].n - 1])
                  {
                     if(_loc12_[_loc11_] != " ")
                     {
                        _loc12_[_loc11_] = "*";
                     }
                     _loc11_++;
                  }
               }
               _loc10_++;
            }
            _loc9_++;
         }
         if(!_loc13_)
         {
            return param1;
         }
         return filterMode == 1 ? null : _loc12_.join("");
      }
      
      // the same for text that has a place of its own (a Jam-A-Gram, a wall
      // post, a bio): left out, it is replaced by a note saying so.
      public static function filterOrNote(param1:String) : String
      {
         var _loc2_:String = filterText(param1);
         return _loc2_ == null ? FILTER_HIDDEN : _loc2_;
      }
      
      // the window: the settings menu's "Chat Filter" row, and by itself
      // the first time an account plays. built like the item finder, from
      // the same pieces of the game's artwork. two lists to pick one row
      // of each from, the row in use tinted green: what is filtered, and
      // what becomes of a filtered word. under them the player's own words
      // and one wide Save button: nothing changes until it is pressed, and
      // it lights up when there is something to save.
      private static var FILTER_LEVELS:Array = [0,1,2];
      
      private static var FILTER_ROW_NAMES:Array = ["No filter","Slurs and threats","Slurs, threats and swearing","Censor the words (****)","Hide the whole message"];
      
      private static var FILTER_ROW_Y:Array = [-104,-64,-24,44,84];
      
      private var _filterWin:Sprite;
      
      private var _filterRowClips:Array;
      
      private var _filterSave:Sprite;
      
      private var _filterWordsBar:MovieClip;
      
      private var _filterWordsInput:TextField;
      
      private var _filterPickLevel:int;
      
      private var _filterPickMode:int;
      
      private function buildChatFilter() : void
      {
         var _loc1_:MovieClip = GETDEFINITIONBYNAME("ReportRulesPopupSkin");
         var _loc2_:MovieClip = GETDEFINITIONBYNAME("ReportRulesPopupContent");
         var _loc3_:int = 1;
         var _loc4_:Sprite = new Sprite();
         var _loc6_:MovieClip = null;
         var _loc8_:TextField = null;
         var _loc9_:Matrix = new Matrix();
         _filterWin = new Sprite();
         _filterWin.graphics.beginFill(0,0.45);
         _filterWin.graphics.drawRect(0,0,900,550);
         _filterWin.graphics.endFill();
         _loc4_.x = 450;
         _loc4_.y = 275;
         _filterWin.addChild(_loc4_);
         _loc4_.addChild(_loc1_);
         _loc2_.x = _loc1_.c.x;
         _loc2_.y = _loc1_.c.y;
         _loc4_.addChild(_loc2_);
         _loc1_.bx.addEventListener("mouseDown",onFilterCloseClick);
         while(_loc3_ <= 5)
         {
            _loc2_["ruleTxt" + _loc3_].visible = false;
            _loc2_["ruleBodyTxt" + _loc3_].visible = false;
            _loc3_++;
         }
         _loc2_.titleTxt.text = "Chat Filter";
         _loc8_ = _loc2_.ruleBodyTxt1;
         _loc8_.visible = true;
         _loc8_.wordWrap = false;
         _loc8_.x = -171;
         _loc8_.y = -152;
         _loc8_.width = 346;
         _loc8_.height = 24;
         _loc8_.text = "Choose what you don't want to see.";
         _loc8_ = _loc2_.ruleBodyTxt2;
         _loc8_.visible = true;
         _loc8_.wordWrap = false;
         _loc8_.x = -171;
         _loc8_.y = 0;
         _loc8_.width = 346;
         _loc8_.height = 24;
         _loc8_.text = "When a word is filtered:";
         _filterRowClips = [];
         _loc3_ = 0;
         while(_loc3_ < 5)
         {
            _loc6_ = GETDEFINITIONBYNAME("textBtnCont");
            _loc6_.x = 2;
            _loc6_.y = FILTER_ROW_Y[_loc3_];
            _loc6_.name = "pick" + _loc3_;
            _loc6_.currTxt.mouseEnabled = false;
            _loc6_.currTxt.text = FILTER_ROW_NAMES[_loc3_];
            _loc6_.addEventListener("mouseDown",onFilterPick);
            _loc2_.addChild(_loc6_);
            _filterRowClips.push(_loc6_);
            _loc3_++;
         }
         _filterWordsBar = finderSearchBar(-171,108,346,"Your own words, spaces between","^%",300,false);
         _filterWordsInput = _filterWordsBar.searchTxt;
         _filterWordsInput.addEventListener("change",onFilterTyped);
         _loc2_.addChild(_filterWordsBar);
         // the Save button: as wide as the rows, in the game's green.
         _filterSave = new Sprite();
         _filterSave.graphics.beginFill(1924906);
         _filterSave.graphics.drawRoundRect(0,0,346,38,38,38);
         _filterSave.graphics.endFill();
         _loc9_.createGradientBox(340,32,Math.PI / 2,3,3);
         _filterSave.graphics.beginGradientFill("linear",[8314449,4105022],[1,1],[0,255],_loc9_);
         _filterSave.graphics.drawRoundRect(3,3,340,32,32,32);
         _filterSave.graphics.endFill();
         _loc8_ = new TextField();
         _loc8_.embedFonts = hasGameFont();
         _loc8_.selectable = false;
         _loc8_.mouseEnabled = false;
         _loc8_.autoSize = "left";
         _loc8_.defaultTextFormat = new TextFormat("CCDigitalDelivery",18,16777215,true);
         _loc8_.text = "Save";
         _loc8_.x = int((346 - _loc8_.width) * 0.5);
         _loc8_.y = int((38 - _loc8_.height) * 0.5);
         _filterSave.addChild(_loc8_);
         _filterSave.x = -171;
         _filterSave.y = 157;
         _filterSave.buttonMode = true;
         _filterSave.mouseChildren = false;
         _filterSave.addEventListener("mouseDown",onFilterSaveClick);
         _loc2_.addChild(_filterSave);
         _filterWin.addEventListener("mouseDown",onFinderMouse);
         _filterWin.addEventListener("mouseUp",onFinderMouse);
         _filterWin.addEventListener("click",onFinderMouse);
         _filterWin.addEventListener("mouseWheel",onFinderMouse);
         _filterWin.visible = false;
         addChild(_filterWin);
      }
      
      private function filterWordsTyped() : String
      {
         var _loc1_:Array = _filterWordsInput.text.split(/[\s,]+/);
         var _loc2_:Array = [];
         var _loc3_:int = 0;
         while(_loc3_ < _loc1_.length && _loc2_.length < 100)
         {
            if(String(_loc1_[_loc3_]).length > 0)
            {
               _loc2_.push(String(_loc1_[_loc3_]).substr(0,30));
            }
            _loc3_++;
         }
         return _loc2_.join(",");
      }
      
      // the rows as the picks stand, and the Save button: bright when what
      // shows differs from what is kept (or nothing was ever chosen), pale
      // when there is nothing to save.
      private function drawChatFilter() : void
      {
         var _loc1_:int = 0;
         var _loc2_:Boolean = false;
         while(_loc1_ < 5)
         {
            _loc2_ = _loc1_ < 3 ? FILTER_LEVELS[_loc1_] == _filterPickLevel : _loc1_ - 3 == _filterPickMode;
            _filterRowClips[_loc1_].transform.colorTransform = _loc2_ ? whisperTint() : new ColorTransform();
            _loc1_++;
         }
         _filterWordsBar.txt.visible = _filterWordsInput.text.length == 0;
         _loc2_ = !filterChosen || _filterPickLevel != filterLevel || _filterPickMode != (filterMode == 1 ? 1 : 0) || filterWordsTyped() != filterOwn;
         _filterSave.alpha = _loc2_ ? 1 : 0.45;
      }
      
      private function onFilterTyped(param1:Event) : void
      {
         drawChatFilter();
      }
      
      // the server's rules, word for word as the owner gave them
      private static const RULES_HTML:String = "<font size=\"16\" color=\"#563421\"><b>[1] Be Respectful / Have Common Sense</b></font><br><font size=\"13\" color=\"#6E4A2E\"><b>This is quite self explanatory. Be kind, treat people how you would want to be treated. If someone is uncomfortable with something you are saying and or doing, please respect that of them and do not argue against it, even if it may seem ridiculous in your eyes.</b></font><br><br><font size=\"16\" color=\"#563421\"><b>[2] No Direct Harassment / Bullying</b></font><br><font size=\"13\" color=\"#6E4A2E\"><b>If you are being disrespectful towards another person, Moderators have every right to punish you. Please don't be an asshole. Thank you.</b></font><br><br><font size=\"16\" color=\"#563421\"><b>[3] Keep Personal Information for Yourself.</b></font><br><font size=\"13\" color=\"#6E4A2E\"><b>As friendly that people may seem on this platform, never share personal identifying details with ANYONE. This leads to a lot of unsafe situations. Please be safe and responsible with the information you give to other people.</b></font><br><br><font size=\"16\" color=\"#563421\"><b>[4] Keep Drama OUT</b></font><br><font size=\"13\" color=\"#6E4A2E\"><b>If you have personal issues with another person, it is not our responsibility unless said person is confirmed to be problematic towards something against the rules of our server. Please do not bring arguments into our public chat, you will be muted until things clear up. Keep it in DMS.</b></font><br><br><font size=\"16\" color=\"#563421\"><b>[5] No NSFW!</b></font><br><font size=\"13\" color=\"#6E4A2E\"><b>NSFW and Suggestive Content are entirely banned from the server, period. We do not want to be a place that allows predatory behavior to fester. If you are unsure of what specific details this goes under, feel free to ask in a ticket.</b></font><br><br><font size=\"16\" color=\"#563421\"><b>[8] Report Any Issues</b></font><br><font size=\"13\" color=\"#6E4A2E\"><b>Issues can be anything from harassment, a person you are uncomfortable with, bugs, etc. Moderators are always happy to help!</b></font><br><br><font size=\"13\" color=\"#6E4A2E\"><b>Burrow gives players more freedom than the original game, including free chat. If you do not want to see certain content you may utilise the client side chat filter and block players, which has an option to completely hide them on your side.</b></font><br><br><font size=\"13\" color=\"#6E4A2E\"><b>These options are found in the in-game settings or player cards.</b></font><br><br><font size=\"16\" color=\"#563421\"><b>burrow.moe/terms</b></font>";
      
      private var _rulesWin:Sprite;
      
      private var _rulesText:TextField;
      
      // what to do once the rules are closed (the chat filter, the first time)
      private static var _rulesThen:Function;
      
      // the rules, in the game's rules popup (its frame and text style), with
      // room for all of them: the text scrolls with the wheel or the arrows.
      // the game's own rules popup (GuiManager.displayRulesPopup) opens this.
      private function buildRules() : void
      {
         var _loc1_:MovieClip = GETDEFINITIONBYNAME("ReportRulesPopupSkin");
         var _loc2_:MovieClip = GETDEFINITIONBYNAME("ReportRulesPopupContent");
         var _loc3_:int = 1;
         var _loc4_:Sprite = new Sprite();
         var _loc5_:MovieClip = null;
         _rulesWin = new Sprite();
         _rulesWin.graphics.beginFill(0,0.45);
         _rulesWin.graphics.drawRect(0,0,900,550);
         _rulesWin.graphics.endFill();
         _loc4_.x = 450;
         _loc4_.y = 275;
         _rulesWin.addChild(_loc4_);
         _loc4_.addChild(_loc1_);
         _loc2_.x = _loc1_.c.x;
         _loc2_.y = _loc1_.c.y;
         _loc4_.addChild(_loc2_);
         _loc1_.bx.addEventListener("mouseDown",onRulesCloseClick);
         while(_loc3_ <= 5)
         {
            _loc2_["ruleTxt" + _loc3_].visible = false;
            _loc2_["ruleBodyTxt" + _loc3_].visible = false;
            _loc3_++;
         }
         _loc2_.titleTxt.text = "Burrow Rules";
         _rulesText = _loc2_.ruleBodyTxt1;
         _rulesText.visible = true;
         _rulesText.multiline = true;
         _rulesText.wordWrap = true;
         _rulesText.mouseWheelEnabled = true;
         _rulesText.selectable = false;
         _rulesText.x = -245;
         _rulesText.y = -158;
         _rulesText.width = 462;
         _rulesText.height = 338;
         _rulesText.htmlText = RULES_HTML;
         _loc5_ = GETDEFINITIONBYNAME("arrow_r_btnContOld");
         _loc5_.rotation = -90;
         _loc5_.x = 236;
         _loc5_.y = -136;
         _loc5_.name = "up";
         _loc5_.addEventListener("mouseDown",onRulesArrow);
         _loc2_.addChild(_loc5_);
         _loc5_ = GETDEFINITIONBYNAME("arrow_r_btnContOld");
         _loc5_.rotation = 90;
         _loc5_.x = 236;
         _loc5_.y = 160;
         _loc5_.name = "down";
         _loc5_.addEventListener("mouseDown",onRulesArrow);
         _loc2_.addChild(_loc5_);
         _rulesWin.addEventListener("mouseDown",onFinderMouse);
         _rulesWin.addEventListener("mouseUp",onFinderMouse);
         _rulesWin.addEventListener("click",onFinderMouse);
         _rulesWin.addEventListener("mouseWheel",onFinderMouse);
         _rulesWin.visible = false;
         addChild(_rulesWin);
      }
      
      private function showRules(param1:Boolean) : void
      {
         if(_rulesWin == null)
         {
            buildRules();
         }
         _rulesWin.visible = param1;
         if(param1)
         {
            _rulesText.scrollV = 1;
            setChildIndex(_rulesWin,numChildren - 1);
         }
      }
      
      private function onRulesArrow(param1:MouseEvent) : void
      {
         param1.stopPropagation();
         _rulesText.scrollV += param1.currentTarget.name == "up" ? -4 : 4;
      }
      
      private function onRulesCloseClick(param1:MouseEvent) : void
      {
         var _loc2_:Function = _rulesThen;
         param1.stopPropagation();
         showRules(false);
         _rulesThen = null;
         if(_loc2_ != null)
         {
            _loc2_();
         }
      }
      
      // the rules window, then `param1` once it is closed
      public static function openRules(param1:Function = null) : void
      {
         if(_toolsInstance == null)
         {
            return;
         }
         try
         {
            _rulesThen = param1;
            _toolsInstance.showRules(true);
         }
         catch(e:Error)
         {
            GlobalErrorCatch.reportToServer("rules: " + e + "\n" + e.getStackTrace());
         }
      }
      
      public static function closeRules() : void
      {
         if(_toolsInstance != null && _toolsInstance._rulesWin != null)
         {
            _rulesThen = null;
            _toolsInstance.showRules(false);
         }
      }
      
      private function showChatFilter(param1:Boolean) : void
      {
         if(_filterWin == null)
         {
            buildChatFilter();
         }
         _filterWin.visible = param1;
         if(param1)
         {
            _filterPickLevel = filterLevel;
            _filterPickMode = filterMode == 1 ? 1 : 0;
            _filterWordsInput.text = filterOwn.split(",").join(" ");
            drawChatFilter();
            setChildIndex(_filterWin,numChildren - 1);
         }
         else
         {
            gMainFrame.stage.focus = null;
         }
      }
      
      private function onFilterPick(param1:MouseEvent) : void
      {
         var _loc2_:int = int(DisplayObject(param1.currentTarget).name.substr(4));
         param1.stopPropagation();
         if(_loc2_ < 3)
         {
            _filterPickLevel = FILTER_LEVELS[_loc2_];
         }
         else
         {
            _filterPickMode = _loc2_ - 3;
         }
         drawChatFilter();
      }
      
      // the picks go to the server, which keeps them with the account and
      // answers with them ("xfl"), and that answer is what takes effect.
      private function saveChatFilter() : void
      {
         gMainFrame.server.setXtObject_Str("xfl",[_filterPickLevel,_filterPickMode,filterWordsTyped()]);
         showChatFilter(false);
      }
      
      private function onFilterSaveClick(param1:MouseEvent) : void
      {
         param1.stopPropagation();
         saveChatFilter();
      }
      
      // closed without saving: nothing changes. the first time, that still
      // counts as having been asked, and what was showing is kept.
      private function onFilterCloseClick(param1:MouseEvent) : void
      {
         param1.stopPropagation();
         if(!filterChosen)
         {
            saveChatFilter();
            return;
         }
         showChatFilter(false);
      }
      
      private function finderButtonText(param1:MovieClip, param2:String) : void
      {
         var _loc3_:Array = [param1.getChildByName("gray"),param1.getChildByName("down")];
         var _loc4_:MovieClip = param1.getChildByName("mouse") as MovieClip;
         var _loc5_:MovieClip = null;
         var _loc6_:TextField = null;
         var _loc7_:int = 0;
         if(_loc4_ != null)
         {
            _loc3_.push(_loc4_.getChildByName("up"));
            _loc3_.push(_loc4_.getChildByName("mouse"));
            _loc7_ = 0;
            while(_loc7_ < _loc4_.numChildren)
            {
               _loc3_.push(_loc4_.getChildAt(_loc7_));
               _loc7_++;
            }
         }
         _loc7_ = 0;
         while(_loc7_ < _loc3_.length)
         {
            _loc5_ = _loc3_[_loc7_] as MovieClip;
            if(_loc5_ != null)
            {
               _loc6_ = _loc5_.getChildByName("txt") as TextField;
               if(_loc6_ != null)
               {
                  _loc6_.text = param2;
               }
            }
            _loc7_++;
         }
      }
      
      private function finderSearchBar(param1:Number, param2:Number, param3:Number, param4:String, param5:String, param6:int, param7:Boolean) : MovieClip
      {
         var _loc8_:MovieClip = GETDEFINITIONBYNAME("searchBar_den");
         var _loc9_:TextField = _loc8_.searchTxt;
         var _loc10_:Shape = new Shape();
         var _loc11_:Matrix = new Matrix();
         var _loc12_:int = 0;
         var _loc13_:Number = param7 ? 35 : 16;
         _loc8_.t.visible = false;
         _loc8_.m.visible = false;
         _loc8_.b.visible = false;
         if(!param7)
         {
            while(_loc12_ < _loc8_.numChildren)
            {
               if(_loc8_.getChildAt(_loc12_) is Shape)
               {
                  _loc8_.getChildAt(_loc12_).visible = false;
               }
               _loc12_++;
            }
         }
         _loc10_.graphics.beginFill(7160624);
         _loc10_.graphics.drawRoundRect(0,4,param3,34,34,34);
         _loc10_.graphics.endFill();
         _loc10_.graphics.beginFill(10115109);
         _loc10_.graphics.drawRoundRect(1,5,param3 - 2,32,32,32);
         _loc10_.graphics.endFill();
         _loc11_.createGradientBox(param3 - 8,26,Math.PI / 2,4,8);
         _loc10_.graphics.beginGradientFill("linear",[11459790,15261660,16250099],[1,1,1],[0,127,255],_loc11_);
         _loc10_.graphics.drawRoundRect(4,8,param3 - 8,26,26,26);
         _loc10_.graphics.endFill();
         _loc8_.addChildAt(_loc10_,0);
         _loc8_.txt.text = param4;
         _loc8_.txt.x = _loc13_;
         _loc8_.txt.width = param3 - _loc13_ - 12;
         _loc8_.txt.mouseEnabled = false;
         _loc9_.type = "input";
         _loc9_.selectable = true;
         _loc9_.mouseEnabled = true;
         _loc9_.visible = true;
         _loc9_.x = _loc13_;
         _loc9_.width = param3 - _loc13_ - 12;
         _loc9_.maxChars = param6;
         _loc9_.text = "";
         if(param5 != null)
         {
            _loc9_.restrict = param5;
         }
         _loc9_.addEventListener("change",onFinderTyped);
         _loc8_.x = param1;
         _loc8_.y = param2;
         return _loc8_;
      }
      
      // A bar's hint shows while nothing is typed in it.
      private function onFinderTyped(param1:Event) : void
      {
         var _loc2_:TextField = param1.target as TextField;
         var _loc3_:MovieClip = _loc2_ == null ? null : _loc2_.parent as MovieClip;
         if(_loc3_ != null && _loc3_.txt != null)
         {
            _loc3_.txt.visible = _loc2_.text.length == 0;
         }
      }
      
      private function buildItemFinder() : void
      {
         var _loc1_:MovieClip = GETDEFINITIONBYNAME("ReportRulesPopupSkin");
         var _loc2_:MovieClip = GETDEFINITIONBYNAME("ReportRulesPopupContent");
         var _loc3_:int = 1;
         var _loc4_:MovieClip = null;
         var _loc5_:MovieClip = null;
         _finder = new Sprite();
         _finder.graphics.beginFill(0,0.45);
         _finder.graphics.drawRect(0,0,900,550);
         _finder.graphics.endFill();
         _finderPanel = new Sprite();
         _finderPanel.x = 450;
         _finderPanel.y = 275;
         _finder.addChild(_finderPanel);
         _finderPanel.addChild(_loc1_);
         _loc2_.x = _loc1_.c.x;
         _loc2_.y = _loc1_.c.y;
         _finderPanel.addChild(_loc2_);
         _loc1_.bx.addEventListener("mouseDown",onFinderCloseClick);
         while(_loc3_ <= 5)
         {
            _loc2_["ruleTxt" + _loc3_].visible = false;
            _loc2_["ruleBodyTxt" + _loc3_].visible = false;
            _loc3_++;
         }
         _loc2_.titleTxt.text = "Item Giver";
         _finderStatus = _loc2_.ruleBodyTxt1;
         _finderStatus.visible = true;
         _finderStatus.wordWrap = false;
         _finderStatus.x = -245;
         _finderStatus.y = -112;
         _finderStatus.width = 490;
         _finderStatus.height = 24;
         _finderStatus.text = "Type a name or an id, then press Enter.";
         _finderPageLabel = _loc2_.ruleBodyTxt2;
         _finderPageLabel.visible = true;
         _finderPageLabel.wordWrap = false;
         _finderPageLabel.x = -60;
         _finderPageLabel.y = 154;
         _finderPageLabel.width = 200;
         _finderPageLabel.height = 24;
         _finderPageLabel.text = "";
         _loc2_.addChild(finderLink(_loc2_.ruleBodyTxt3,"Colour picker",FINDER_COLOUR_PICKER,60,154,150));
         _finderInputBar = finderSearchBar(-247,-160,212,"Name or id",null,60,true);
         _finderInput = _finderInputBar.searchTxt;
         _loc2_.addChild(_finderInputBar);
         _finderKindButton = GETDEFINITIONBYNAME("introBtnCont");
         _finderKindButton.x = -30;
         _finderKindButton.y = -156;
         finderButtonText(_finderKindButton,"All items");
         _finderKindButton.addEventListener("mouseDown",onFinderKindClick);
         _loc2_.addChild(_finderKindButton);
         _finderColourBar = finderSearchBar(93,-160,156,"Colour ID or #hex","0-9a-fA-F# ,",31,false);
         _finderColourInput = _finderColourBar.searchTxt;
         _finderColourInput.addEventListener("change",onFinderColourTyped);
         _loc2_.addChild(_finderColourBar);
         _finderRows = new Sprite();
         _finderRows.x = 0;
         _finderRows.y = -62;
         _loc2_.addChild(_finderRows);
         _loc4_ = GETDEFINITIONBYNAME("arrow_l_btnContOld");
         _loc4_.x = -228;
         _loc4_.y = 166;
         _loc4_.addEventListener("mouseDown",onFinderPrevClick);
         _loc2_.addChild(_loc4_);
         _loc5_ = GETDEFINITIONBYNAME("arrow_r_btnContOld");
         _loc5_.x = 228;
         _loc5_.y = 166;
         _loc5_.addEventListener("mouseDown",onFinderNextClick);
         _loc2_.addChild(_loc5_);
         _finder.addEventListener("mouseDown",onFinderMouse);
         _finder.addEventListener("mouseUp",onFinderMouse);
         _finder.addEventListener("click",onFinderMouse);
         _finder.addEventListener("mouseWheel",onFinderMouse);
         _finder.visible = false;
         addChild(_finder);
      }
      
      // made by players for working out custom colours
      private static const FINDER_COLOUR_PICKER:String = "https://aj-color-picker.carrd.co/";
      
      // `param1` (a text field of the artwork's, for its font) as a link at
      // param4, param5, right-aligned in param6. the game's webview may open
      // no window, so the page asks the client to open it in the system
      // browser (ajOpenPage in public/game.html); clients before 1.1.2 drop
      // that, so the address is copied as well.
      private function finderLink(param1:TextField, param2:String, param3:String, param4:Number, param5:Number, param6:Number) : Sprite
      {
         var _loc7_:Sprite = new Sprite();
         var _loc8_:TextFormat = param1.getTextFormat();
         _loc8_.align = "right";
         _loc8_.underline = true;
         param1.parent.removeChild(param1);
         param1.visible = true;
         param1.wordWrap = false;
         param1.selectable = false;
         param1.x = 0;
         param1.y = 0;
         param1.width = param6;
         param1.height = 24;
         param1.defaultTextFormat = _loc8_;
         param1.text = param2;
         param1.setTextFormat(_loc8_);
         _loc7_.addChild(param1);
         _loc7_.x = param4;
         _loc7_.y = param5;
         _loc7_.buttonMode = true;
         _loc7_.useHandCursor = true;
         _loc7_.mouseChildren = false;
         _loc7_.addEventListener("mouseDown",function(param1:MouseEvent):void
         {
            param1.stopPropagation();
            try
            {
               System.setClipboard(param3);
            }
            catch(e:Error)
            {
            }
            try
            {
               if(ExternalInterface.available)
               {
                  ExternalInterface.call("ajOpenPage",param3);
               }
            }
            catch(e:Error)
            {
            }
            _finderStatus.text = "Link copied.";
         });
         return _loc7_;
      }
      
      private function showItemFinder(param1:Boolean) : void
      {
         if(_finder == null)
         {
            buildItemFinder();
         }
         _finder.visible = param1;
         if(param1)
         {
            setChildIndex(_finder,numChildren - 1);
            gMainFrame.stage.focus = _finderInput;
         }
         else
         {
            gMainFrame.stage.focus = null;
         }
      }
      
      private function onFinderMouse(param1:Event) : void
      {
         param1.stopPropagation();
      }
      
      private function onFinderCloseClick(param1:MouseEvent) : void
      {
         param1.stopPropagation();
         showItemFinder(false);
      }

      // ---- the staff's window for one player, from the report button of
      // their card. each button is a staff command for that player ("xmd",
      // which the server runs as if typed: lib/commands.js, its permission
      // checks and log included); only the ones the role allows are shown.
      // the window closes and the server's answer comes as a message box.
      private static const MODERATE_REASONS:Array = ["behavior","bullying","personal","scamming"];

      private static const MODERATE_REASON_NAMES:Array = ["Inappropriate behavior","Bullying","Personal information","Scamming"];

      private function buildModerate() : void
      {
         var _loc1_:MovieClip = GETDEFINITIONBYNAME("ReportRulesPopupSkin");
         var _loc2_:int = 1;
         _moderate = new Sprite();
         _moderate.graphics.beginFill(0,0.45);
         _moderate.graphics.drawRect(0,0,900,550);
         _moderate.graphics.endFill();
         var _loc3_:Sprite = new Sprite();
         _loc3_.x = 450;
         _loc3_.y = 275;
         _moderate.addChild(_loc3_);
         _loc3_.addChild(_loc1_);
         _moderateContent = GETDEFINITIONBYNAME("ReportRulesPopupContent");
         _moderateContent.x = _loc1_.c.x;
         _moderateContent.y = _loc1_.c.y;
         _loc3_.addChild(_moderateContent);
         _loc1_.bx.addEventListener("mouseDown",onModerateCloseClick);
         while(_loc2_ <= 5)
         {
            _moderateContent["ruleTxt" + _loc2_].visible = false;
            _moderateContent["ruleBodyTxt" + _loc2_].visible = false;
            _loc2_++;
         }
         var _loc4_:TextField = _moderateContent.ruleBodyTxt1;
         _loc4_.visible = true;
         _loc4_.wordWrap = true;
         _loc4_.x = -245;
         _loc4_.y = -150;
         _loc4_.width = 490;
         _loc4_.height = 40;
         _loc4_.text = "What you do here is written down under your name, as in the moderator panel.";
         _moderateButtons = [];
         // a row each: warn (the reason cycles), a message, chat, moving them.
         moderateButton("reason","",-150,-88,"player.warn");
         moderateButton("warn","Warn",90,-88,"player.warn");
         _moderateMessageBar = finderSearchBar(-247,-56,330,"Message to show them",null,200,false);
         _moderateContent.addChild(_moderateMessageBar);
         moderateButton("message","Send",150,-52,"player.warn");
         moderateButton("silence 1","Silence 1 hour",-160,12,"chat.silence");
         moderateButton("silence 24","Silence 1 day",0,12,"chat.silence");
         moderateButton("silence off","Lift silence",160,12,"chat.silence");
         moderateButton("summon","Bring here",-160,72,"player.summon");
         moderateButton("goto","Go to them",0,72,"player.goto");
         moderateButton("kick","Disconnect",160,72,"player.kick");
         // their warnings, and taking back the latest (one given by mistake)
         moderateButton("warnings","Warnings",-80,132,"player.warn");
         moderateButton("unwarn","Take back warning",80,132,"player.warn");
         _moderate.addEventListener("mouseDown",onFinderMouse);
         _moderate.addEventListener("mouseUp",onFinderMouse);
         _moderate.addEventListener("click",onFinderMouse);
         _moderate.addEventListener("mouseWheel",onFinderMouse);
         _moderate.visible = false;
         addChild(_moderate);
      }

      private function moderateButton(param1:String, param2:String, param3:Number, param4:Number, param5:String) : void
      {
         var _loc6_:MovieClip = GETDEFINITIONBYNAME("introBtnCont");
         _loc6_.x = param3;
         _loc6_.y = param4;
         _loc6_.name = param1;
         finderButtonText(_loc6_,param2);
         _loc6_.addEventListener("mouseDown",onModerateButton);
         _moderateContent.addChild(_loc6_);
         _moderateButtons.push({
            "clip":_loc6_,
            "permission":param5
         });
      }

      private function showModerate(param1:String) : void
      {
         if(_moderate == null)
         {
            buildModerate();
         }
         _moderateName = param1;
         _moderateReason = 0;
         _moderateContent.titleTxt.text = "Moderate " + param1;
         _moderateMessageBar.searchTxt.text = "";
         _moderateMessageBar.txt.visible = true;
         for each(var _loc2_:Object in _moderateButtons)
         {
            _loc2_.clip.visible = staffMay(_loc2_.permission);
         }
         _moderateMessageBar.visible = staffMay("player.warn");
         showModerateReason();
         _moderate.visible = true;
         setChildIndex(_moderate,numChildren - 1);
      }

      private function showModerateReason() : void
      {
         finderButtonText(_moderateContent.getChildByName("reason") as MovieClip,MODERATE_REASON_NAMES[_moderateReason]);
      }

      private function hideModerate() : void
      {
         if(_moderate != null)
         {
            _moderate.visible = false;
         }
         gMainFrame.stage.focus = null;
      }

      private function onModerateCloseClick(param1:MouseEvent) : void
      {
         param1.stopPropagation();
         hideModerate();
      }

      private function onModerateButton(param1:MouseEvent) : void
      {
         param1.stopPropagation();
         var _loc2_:String = MovieClip(param1.currentTarget).name;
         var _loc3_:String = null;
         if(_loc2_ == "reason")
         {
            _moderateReason = (_moderateReason + 1) % MODERATE_REASONS.length;
            showModerateReason();
            return;
         }
         if(_loc2_ == "warn")
         {
            gMainFrame.server.setXtObject_Str("xmd",["warn",_moderateName,MODERATE_REASONS[_moderateReason]]);
         }
         else if(_loc2_ == "message")
         {
            // "%" ends a field of the message: left out.
            _loc3_ = _moderateMessageBar.searchTxt.text.split("%").join("").replace(/^\s+|\s+$/g,"");
            if(_loc3_.length == 0)
            {
               gMainFrame.stage.focus = _moderateMessageBar.searchTxt;
               return;
            }
            gMainFrame.server.setXtObject_Str("xmd",["message",_moderateName,_loc3_]);
         }
         else if(_loc2_.indexOf("silence ") == 0)
         {
            gMainFrame.server.setXtObject_Str("xmd",["silence",_moderateName,_loc2_.substr(8)]);
         }
         else
         {
            gMainFrame.server.setXtObject_Str("xmd",[_loc2_,_moderateName]);
         }
         hideModerate();
      }
      
      private function onFinderKey(param1:KeyboardEvent) : void
      {
         if(param1.eventPhase == 3)
         {
            return;
         }
         var _loc2_:Boolean = _finder != null && _finder.visible;
         // the rules: Esc closes them as their X does
         if(_rulesWin != null && _rulesWin.visible)
         {
            if(param1.keyCode == 27)
            {
               onRulesCloseClick(new MouseEvent("mouseDown"));
            }
            param1.stopImmediatePropagation();
            return;
         }
         // the chat filter's window: Esc leaves it as its X does, Enter
         // saves, and no key gets past it to the game.
         if(_filterWin != null && _filterWin.visible)
         {
            if(param1.keyCode == 27)
            {
               onFilterCloseClick(new MouseEvent("mouseDown"));
            }
            else if(param1.keyCode == 13)
            {
               saveChatFilter();
            }
            param1.stopImmediatePropagation();
            return;
         }
         if(param1.keyCode == 120)
         {
            openTool(0);
            if(_loc2_)
            {
               showItemFinder(false);
            }
            param1.stopImmediatePropagation();
            return;
         }
         if(_loc2_)
         {
            if(param1.keyCode == 27)
            {
               showItemFinder(false);
            }
            else if(param1.keyCode == 13)
            {
               finderSearch();
            }
            param1.stopImmediatePropagation();
         }
      }
      
      private function onFinderKindClick(param1:MouseEvent) : void
      {
         param1.stopPropagation();
         _finderKind = (_finderKind + 1) % 3;
         finderButtonText(_finderKindButton,_finderKind == 0 ? "All items" : (_finderKind == 1 ? "Clothing" : "Den items"));
         finderSearch();
      }
      
      private function finderSearch() : void
      {
         if(gMainFrame.stage.focus != _finderColourInput)
         {
            gMainFrame.stage.focus = _finderInput;
         }
         if(_finderInput.text.length == 0)
         {
            _finderStatus.text = "Type a name or an id, then press Enter.";
            return;
         }
         var _loc1_:String = _finderKind == 0 ? "all" : (_finderKind == 1 ? "clothing" : "den");
         var _loc2_:URLLoader = new URLLoader();
         _loc2_.addEventListener("complete",onFinderSearchDone);
         _loc2_.addEventListener("ioError",onFinderFailed);
         _loc2_.addEventListener("securityError",onFinderFailed);
         _finderStatus.text = "Searching...";
         _loc2_.load(new URLRequest(gMainFrame.clientInfo.websiteURL + "api/search?kind=" + _loc1_ + "&q=" + encodeURIComponent(_finderInput.text) + "&username=" + encodeURIComponent(gMainFrame.server.userName) + "&token=" + encodeURIComponent(gMainFrame.clientInfo.authToken)));
      }
      
      private function onFinderFailed(param1:Event) : void
      {
         _finderStatus.text = "The server did not accept that.";
      }
      
      private function onFinderSearchDone(param1:Event) : void
      {
         var _loc2_:Object = JSON.parse(String(URLLoader(param1.target).data));
         _finderResults = _loc2_.results as Array;
         _finderTotal = int(_loc2_.total);
         _finderPage = 0;
         for each(var _loc3_:Object in _finderResults)
         {
            _loc3_.colorIndex = 0;
         }
         if(_finderTotal == 0)
         {
            _finderStatus.text = "Nothing matches.";
         }
         else if(_finderTotal > _finderResults.length)
         {
            _finderStatus.text = "Showing the first " + _finderResults.length + " of " + _finderTotal + " matches.";
         }
         else
         {
            _finderStatus.text = _finderTotal + (_finderTotal == 1 ? " match." : " matches.") + " Click a row to change its colour.";
         }
         renderFinderRows();
      }
      
      private function finderRowText(param1:Object) : String
      {
         var _loc2_:String = param1.id + "   " + param1.name + "   (" + (param1.kind == "den" ? "den item" : "clothing");
         if(int(param1.colors) > 1)
         {
            _loc2_ += ", colour " + (int(param1.colorIndex) + 1) + "/" + param1.colors;
         }
         return _loc2_ + ")";
      }
      
      private function renderFinderRows() : void
      {
         var _loc1_:Object = null;
         var _loc2_:int = 0;
         var _loc3_:MovieClip = null;
         var _loc4_:MovieClip = null;
         while(_finderRows.numChildren > 0)
         {
            _finderRows.removeChildAt(0);
         }
         for each(var _loc6_:Object in _finderIcons)
         {
            try
            {
               _loc6_.destroy();
            }
            catch(e:Error)
            {
            }
         }
         _finderIcons = {};
         var _loc5_:int = Math.max(1,Math.ceil(_finderResults.length / 6));
         _loc2_ = _finderPage * 6;
         while(_loc2_ < _finderResults.length && _loc2_ < _finderPage * 6 + 6)
         {
            _loc1_ = _finderResults[_loc2_];
            _loc3_ = GETDEFINITIONBYNAME("textBtnCont");
            _loc3_.x = -74;
            _loc3_.y = (_loc2_ - _finderPage * 6) * 40;
            _loc3_.name = "row" + _loc2_;
            _loc3_.currTxt.mouseEnabled = false;
            _loc3_.currTxt.text = finderRowText(_loc1_);
            _loc3_.addEventListener("mouseDown",onFinderColourClick);
            _finderRows.addChild(_loc3_);
            _loc4_ = GETDEFINITIONBYNAME("buyBtnCont");
            _loc4_.scaleX = 0.8;
            _loc4_.scaleY = 0.8;
            _loc4_.x = 152;
            _loc4_.y = _loc3_.y;
            _loc4_.name = "give" + _loc2_;
            finderButtonText(_loc4_,"Give");
            _loc4_.addEventListener("mouseDown",onFinderGiveClick);
            _finderRows.addChild(_loc4_);
            _finderRows.addChild(finderPreview(_loc1_,_loc2_,226,_loc3_.y));
            _loc2_++;
         }
         _finderPageLabel.text = _finderResults.length == 0 ? "" : "Page " + (_finderPage + 1) + " of " + _loc5_;
      }
      
      private function onFinderPrevClick(param1:MouseEvent) : void
      {
         param1.stopPropagation();
         if(_finderPage > 0)
         {
            _finderPage--;
            renderFinderRows();
         }
      }
      
      private function onFinderNextClick(param1:MouseEvent) : void
      {
         param1.stopPropagation();
         if((_finderPage + 1) * 6 < _finderResults.length)
         {
            _finderPage++;
            renderFinderRows();
         }
      }
      
      private function onFinderColourClick(param1:MouseEvent) : void
      {
         var _loc2_:MovieClip = MovieClip(param1.currentTarget);
         var _loc3_:Object = _finderResults[int(_loc2_.name.substr(3))];
         param1.stopPropagation();
         if(_loc3_ != null && int(_loc3_.colors) > 1)
         {
            _loc3_.colorIndex = (int(_loc3_.colorIndex) + 1) % int(_loc3_.colors);
            _loc2_.currTxt.text = finderRowText(_loc3_);
            recolourFinderPreview(int(_loc2_.name.substr(3)));
         }
      }
      
      private function onFinderGiveClick(param1:MouseEvent) : void
      {
         var _loc2_:Object = _finderResults[int(MovieClip(param1.currentTarget).name.substr(4))];
         var _loc3_:URLRequest = new URLRequest(gMainFrame.clientInfo.websiteURL + "api/give");
         param1.stopPropagation();
         _loc3_.method = "POST";
         _loc3_.contentType = "application/json";
         var _loc5_:Object = {
            "username":gMainFrame.server.userName,
            "token":gMainFrame.clientInfo.authToken,
            "kind":_loc2_.kind,
            "id":_loc2_.id,
            "colorIndex":_loc2_.colorIndex
         };
         if(_finderColourInput.text.length > 0 && _loc2_.kind != "den")
         {
            if(_finderColourInput.text.indexOf("#") >= 0 ? finderHexColours(_finderColourInput.text) == null : !/^\s*[0-9]+\s*$/.test(_finderColourInput.text))
            {
               _finderStatus.text = "Colour: an id, or #RRGGBB";
               return;
            }
            _loc5_.color = _finderColourInput.text;
         }
         _loc3_.data = JSON.stringify(_loc5_);
         var _loc4_:URLLoader = new URLLoader();
         _loc4_.addEventListener("complete",onFinderGiveDone);
         _loc4_.addEventListener("ioError",onFinderFailed);
         _loc4_.addEventListener("securityError",onFinderFailed);
         _finderStatus.text = "Adding " + _loc2_.name + "...";
         _loc4_.load(_loc3_);
      }
      
      // one to four "#RRGGBB" (spaces or commas between) as the four colour
      // bands' RGB values, the last filling the rest; null if it is not that.
      // the server reads the box the same way (lib/admin.js).
      private static function finderHexColours(param1:String) : Array
      {
         var _loc2_:String = param1.replace(/^\s+|\s+$/g,"");
         var _loc3_:Array = null;
         var _loc4_:Array = [];
         var _loc5_:int = 0;
         if(!/^#[0-9a-f]{6}([\s,]+#[0-9a-f]{6}){0,3}$/i.test(_loc2_))
         {
            return null;
         }
         _loc3_ = _loc2_.split(/[\s,]+/);
         while(_loc5_ < 4)
         {
            _loc4_.push(uint(parseInt(String(_loc3_[Math.min(_loc5_,_loc3_.length - 1)]).substr(1),16)));
            _loc5_++;
         }
         return _loc4_;
      }
      
      // the colour a clothing row is drawn in: the box's colour id or hex
      // colour, else the item's own colour that the row is on
      private function finderPreviewColour(param1:Object) : uint
      {
         var _loc2_:String = _finderColourInput == null ? "" : _finderColourInput.text.replace(/^\s+|\s+$/g,"");
         var _loc3_:Array = null;
         var _loc4_:Object = null;
         if(_loc2_.length > 0 && _loc2_.indexOf("#") >= 0)
         {
            _loc3_ = finderHexColours(_loc2_);
            if(_loc3_ != null)
            {
               if(_loc3_.join(",") != _finderHexKey)
               {
                  // a new id each time, so no drawing keeps the old palette;
                  // 0xFDFFFF00 and up is far past what the server hands out
                  _finderHexKey = _loc3_.join(",");
                  _finderHexId = uint(0xFDFFFF00 + (_finderHexCount++ & 0xFF));
                  PaletteHelper.customColors[_finderHexId] = _loc3_;
               }
               return _finderHexId;
            }
         }
         else if(/^[0-9]+$/.test(_loc2_))
         {
            return uint(Number(_loc2_));
         }
         _loc4_ = ItemXtCommManager.getItemDef(int(param1.id));
         if(_loc4_ == null || _loc4_.colors == null || _loc4_.colors.length == 0)
         {
            return 0;
         }
         return uint(_loc4_.colors[Math.min(int(param1.colorIndex),_loc4_.colors.length - 1)]);
      }
      
      // the row's item as the game draws it in a shop, in a box at the row's end
      private function finderPreview(param1:Object, param2:int, param3:Number, param4:Number) : Sprite
      {
         var _loc5_:Sprite = new Sprite();
         var _loc6_:Sprite = new Sprite();
         var _loc7_:Matrix = new Matrix();
         var _loc8_:* = null;
         var _loc9_:Sprite = null;
         _loc5_.x = param3;
         _loc5_.y = param4;
         _loc5_.mouseEnabled = false;
         _loc5_.mouseChildren = false;
         _loc5_.graphics.beginFill(7160624);
         _loc5_.graphics.drawRoundRect(-19,-19,38,38,14,14);
         _loc5_.graphics.endFill();
         _loc5_.graphics.beginFill(10115109);
         _loc5_.graphics.drawRoundRect(-18,-18,36,36,12,12);
         _loc5_.graphics.endFill();
         _loc7_.createGradientBox(32,32,Math.PI / 2,-16,-16);
         _loc5_.graphics.beginGradientFill("linear",[11459790,15261660,16250099],[1,1,1],[0,127,255],_loc7_);
         _loc5_.graphics.drawRoundRect(-16,-16,32,32,10,10);
         _loc5_.graphics.endFill();
         _loc5_.addChild(_loc6_);
         try
         {
            if(param1.kind == "den")
            {
               if(DenXtCommManager.getDenItemDef(int(param1.id)) == null)
               {
                  return _loc5_;
               }
               _loc8_ = new DenItem();
               DenItem(_loc8_).initShopItem(int(param1.id),0);
            }
            else
            {
               if(ItemXtCommManager.getItemDef(int(param1.id)) == null)
               {
                  return _loc5_;
               }
               _loc8_ = new Item();
               Item(_loc8_).init(int(param1.id),0,finderPreviewColour(param1),null,true);
            }
            // fitted to the box once drawn, which may be before the icon is
            // handed back when its picture was loaded already
            _loc8_.imageLoadedCallback = function():void
            {
               var _loc1_:Number = 0;
               if(_loc6_.numChildren > 0)
               {
                  _loc6_.scaleX = _loc6_.scaleY = 1;
                  _loc1_ = Math.max(_loc6_.width,_loc6_.height);
                  if(_loc1_ > 0)
                  {
                     _loc6_.scaleX = _loc6_.scaleY = Math.min(1,30 / _loc1_);
                  }
               }
            };
            _loc9_ = _loc8_.icon;
            if(_loc9_ != null)
            {
               _loc6_.addChild(_loc9_);
               if(_loc8_.isIconLoaded)
               {
                  _loc8_.imageLoadedCallback();
               }
            }
            _finderIcons[param2] = _loc8_;
         }
         catch(e:Error)
         {
            GlobalErrorCatch.reportToServer("item giver preview " + param1.kind + " " + param1.id + ": " + e);
         }
         return _loc5_;
      }
      
      private function recolourFinderPreview(param1:int) : void
      {
         var _loc2_:Item = _finderIcons[param1] as Item;
         if(_loc2_ != null && _finderResults[param1] != null)
         {
            _loc2_.color = finderPreviewColour(_finderResults[param1]);
            _loc2_.icon;
         }
      }
      
      // the previews follow the colour box once what is in it reads as a
      // colour, or is emptied
      private function onFinderColourTyped(param1:Event) : void
      {
         var _loc2_:String = _finderColourInput.text.replace(/^\s+|\s+$/g,"");
         if(_loc2_.length == 0 || /^[0-9]+$/.test(_loc2_) || finderHexColours(_loc2_) != null)
         {
            for(var _loc3_:String in _finderIcons)
            {
               recolourFinderPreview(int(_loc3_));
            }
         }
      }
      
      private function onFinderGiveDone(param1:Event) : void
      {
         _finderStatus.text = "Added to your inventory.";
      }
      
      private function onInitiationFailure() : void
      {
         new SBStandardPopup(gMainFrame.stage,LocalizationManager.translateIdOnly(11202),false);
      }
      
      private function createAvatar() : void
      {
      }
      
      private function shardSelection() : void
      {
      }
      
      private function enterGame() : void
      {
      }
      
      private function handleGlobalErrors(param1:UncaughtErrorEvent) : void
      {
         GlobalErrorCatch.globalErrorListener(param1);
      }
   }
}

