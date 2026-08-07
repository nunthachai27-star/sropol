unit HOSxPPCUAccount2ANCServiceEntryFormUnit;

interface

uses
  Windows, Messages, SysUtils, Variants, Classes, Graphics, Controls, Forms,
  Dialogs, cxGraphics, cxLookAndFeels, cxLookAndFeelPainters, Menus,
  dxSkinsCore, dxSkinsDefaultPainters, StdCtrls, cxButtons, ExtCtrls,
  JvExControls, JvNavigationPane, cxControls, cxContainer, cxEdit, cxGroupBox,
  DB, DBClient, cxTextEdit, cxDBEdit, cxLabel, cxMaskEdit, cxDropDownEdit,
  cxLookupEdit, cxDBLookupEdit, cxDBLookupComboBox, dxSkinscxPCPainter,
  cxCheckBox, cxSpinEdit, cxPC, cxTimeEdit, cxCalendar, OneStopServiceDMU,
  JvComponentBase, JvFormPlacement;

{$RTTI EXPLICIT METHODS(DefaultMethodRttiVisibility) FIELDS(DefaultFieldRttiVisibility) PROPERTIES(DefaultPropertyRttiVisibility)}
type
  THOSxPPCUAccount2ANCServiceEntryForm = class(TForm)
    JvNavPanelHeader1: TJvNavPanelHeader;
    Panel2: TPanel;
    CloseButton: TcxButton;
    SaveButton: TcxButton;
    DeleteButton: TcxButton;
    LogViewButton: TcxButton;
    JvFormStorage1: TJvFormStorage;

    procedure PersonANCServiceCDSBeforePost(DataSet: TDataSet);
    procedure CloseButtonClick(Sender: TObject);
    procedure SaveButtonClick(Sender: TObject);
    procedure DeleteButtonClick(Sender: TObject);
    procedure LogViewButtonClick(Sender: TObject);
    procedure PersonANCScreenCDSBeforePost(DataSet: TDataSet);
    procedure PersonANCServiceCDSNewRecord(DataSet: TDataSet);
    procedure FormCreate(Sender: TObject);
  private



    FHOSxPPCUAccount2ANCServiceEntryFrame:TFrame;
    FPersonANCServiceID: Integer;
    FPersonANCID: Integer;
    procedure SetPersonANCServiceID(const Value: Integer);
    procedure RefreshData;
    procedure DoSaveData;
    procedure DoDeleteData;
    procedure SetPersonANCID(const Value: Integer);
    { Private declarations }
  public
    { Public declarations }
    property PersonANCServiceID: Integer read FPersonANCServiceID
      write SetPersonANCServiceID;
    property PersonANCID: Integer read FPersonANCID write SetPersonANCID;
    class procedure DoShowForm(xPersonANCID, xPersonANCServiceID: Integer);
  end;

var
  HOSxPPCUAccount2ANCServiceEntryForm: THOSxPPCUAccount2ANCServiceEntryForm;

implementation

uses HOSxPDMU, BMSApplicationUtil, HOSxPPCUAccount2DataModuleUnit,jvappstorage;

{$R *.dfm}
{ THOSxPSystemSettingIPDBedEntryForm }

procedure THOSxPPCUAccount2ANCServiceEntryForm.PersonANCScreenCDSBeforePost
  (DataSet: TDataSet);
begin
  if (DataSet.State in [dsinsert]) then
  begin
    repeat
      DataSet.FieldByName('person_anc_screen_id').AsInteger :=
        getserialnumber('person_anc_screen_id');
    until getsqldata
      ('select count(*) as cc from person_anc_screen where person_anc_screen_id = '
      + DataSet.FieldByName('person_anc_screen_id').asstring) = 0;
  end;

  DataSet.FieldByName('person_anc_service_id').AsInteger := FPersonANCServiceID;
end;

procedure THOSxPPCUAccount2ANCServiceEntryForm.PersonANCServiceCDSBeforePost
  (DataSet: TDataSet);
begin
  if (DataSet.State in [dsinsert]) then
  begin
    DataSet.FieldByName('person_anc_service_id').AsInteger :=
      FPersonANCServiceID;
  end;

  DataSet.FieldByName('person_anc_id').AsInteger := FPersonANCID;

end;

procedure THOSxPPCUAccount2ANCServiceEntryForm.PersonANCServiceCDSNewRecord
  (DataSet: TDataSet);
begin
  DataSet.FieldByName('anc_service_type_id').AsInteger := 1;
  DataSet.FieldByName('anc_location_type_id').AsInteger := 1;
end;

procedure THOSxPPCUAccount2ANCServiceEntryForm.SaveButtonClick(Sender: TObject);
begin
   DoSaveData;
  Close;
end;

procedure THOSxPPCUAccount2ANCServiceEntryForm.DeleteButtonClick
  (Sender: TObject);
begin
  if messagedlg('Please confirm delete data ?', mtconfirmation, [mbyes, mbno],
    0) <> mryes then
    exit;
  DoDeleteData;
  Close;
end;

procedure THOSxPPCUAccount2ANCServiceEntryForm.CloseButtonClick
  (Sender: TObject);
begin
  ExecuteRTTIObjectMethod(FHOSxPPCUAccount2ANCServiceEntryFrame,'DoClearInvalidVisit',[]);
  Close;
end;

procedure THOSxPPCUAccount2ANCServiceEntryForm.LogViewButtonClick
  (Sender: TObject);
begin
  SafeLoadPackage('HOSxPUserManagerPackage.bpl');

  ExecuteRTTIFunction
    ('HOSxPUserManagerLogViewerFormUnit.THOSxPUserManagerLogViewerForm',
    'DoShowForm', ['"person_anc_service"', inttostr(FPersonANCServiceID)]);
end;

procedure THOSxPPCUAccount2ANCServiceEntryForm.DoDeleteData;
begin
  ExecuteRTTIObjectMethod(FHOSxPPCUAccount2ANCServiceEntryFrame,'DoDeleteData',[]);

end;

procedure THOSxPPCUAccount2ANCServiceEntryForm.DoSaveData;
var
  i: Integer;
  ic1: Integer;
begin
  ExecuteRTTIObjectMethod(FHOSxPPCUAccount2ANCServiceEntryFrame,'DoSaveData',[]);

end;

class procedure THOSxPPCUAccount2ANCServiceEntryForm.DoShowForm(xPersonANCID,
  xPersonANCServiceID: Integer);
var
  FHOSxPPCUAccount2ANCServiceEntryForm: THOSxPPCUAccount2ANCServiceEntryForm;
begin
  FHOSxPPCUAccount2ANCServiceEntryForm :=
    THOSxPPCUAccount2ANCServiceEntryForm.Create(application);
  try
    FHOSxPPCUAccount2ANCServiceEntryForm.PersonANCID := xPersonANCID;
    FHOSxPPCUAccount2ANCServiceEntryForm.PersonANCServiceID :=
      xPersonANCServiceID;
    FHOSxPPCUAccount2ANCServiceEntryForm.ShowModal;
  finally
    FHOSxPPCUAccount2ANCServiceEntryForm.Free;
  end;

end;

procedure THOSxPPCUAccount2ANCServiceEntryForm.FormCreate(Sender: TObject);
begin
  JvFormStorage1.StoredPropsPath := self.ClassName;
  JvFormStorage1.AppStorage := TJvCustomAppStorage
    (ExecuteRTTIFunction('MainFormUnit.TMainForm', 'GetApplicationJvAppStorage',
    []).AsObject);

end;

procedure THOSxPPCUAccount2ANCServiceEntryForm.RefreshData;
var
  i: Integer;
begin
  if not assigned(FHOSxPPCUAccount2ANCServiceEntryFrame) then
  begin
    FHOSxPPCUAccount2ANCServiceEntryFrame := TFrame(
    ExecuteRTTIFunction('HOSxPPCUAccount2ANCServiceEntryFrameUnit.THOSxPPCUAccount2ANCServiceEntryFrame','Create',[self]).AsObject);
    FHOSxPPCUAccount2ANCServiceEntryFrame.Parent:=self;
    FHOSxPPCUAccount2ANCServiceEntryFrame.Align:=alclient;
  end;

  SetRTTIObjectProperty(FHOSxPPCUAccount2ANCServiceEntryFrame,'PersonANCID',self.FPersonANCID);
  SetRTTIObjectProperty(FHOSxPPCUAccount2ANCServiceEntryFrame,'PersonANCServiceID',self.FPersonANCServiceID);

  FPersonANCServiceID:=GetRTTIObjectProperty(FHOSxPPCUAccount2ANCServiceEntryFrame,'PersonANCServiceID').AsInteger;

end;

procedure THOSxPPCUAccount2ANCServiceEntryForm.SetPersonANCID
  (const Value: Integer);
begin
  FPersonANCID := Value;

end;

procedure THOSxPPCUAccount2ANCServiceEntryForm.SetPersonANCServiceID
  (const Value: Integer);
begin
  FPersonANCServiceID := Value;

  RefreshData;
 
end;

end.
