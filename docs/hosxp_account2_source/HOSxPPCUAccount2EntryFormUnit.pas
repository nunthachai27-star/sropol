unit HOSxPPCUAccount2EntryFormUnit;

interface

uses
  Windows, Messages, SysUtils, Variants, Classes, Graphics, Controls, Forms,
  Dialogs, cxGraphics, cxLookAndFeels, cxLookAndFeelPainters, Menus,
  dxSkinsCore, dxSkinsDefaultPainters, StdCtrls, cxButtons, ExtCtrls,
  JvExControls, JvNavigationPane, cxControls, cxContainer, cxEdit, cxGroupBox,
  DB, DBClient, cxTextEdit, cxDBEdit, cxLabel, cxMaskEdit, cxDropDownEdit,
  cxLookupEdit, cxDBLookupEdit, cxDBLookupComboBox, dxSkinscxPCPainter, cxPC,
  cxStyles, cxCustomData, cxFilter, cxData, cxDataStorage, cxNavigator,
  cxDBData, cxGridLevel, cxGridCustomTableView, cxGridTableView,
  cxGridDBTableView, cxClasses, cxGridCustomView, cxGrid, JvComponentBase,
  JvFormPlacement, cxCheckBox, dxBarBuiltInMenu, cxCalendar, dxDateRanges, dxScrollbarAnnotations;

{$RTTI EXPLICIT METHODS(DefaultMethodRttiVisibility) FIELDS(DefaultFieldRttiVisibility) PROPERTIES(DefaultPropertyRttiVisibility)}

type
  THOSxPPCUAccount2EntryForm = class(TForm)
    JvNavPanelHeader1: TJvNavPanelHeader;
    Panel2: TPanel;
    CloseButton: TcxButton;
    SaveButton: TcxButton;
    DeleteButton: TcxButton;
    LogViewButton: TcxButton;
    cxPageControl1: TcxPageControl;
    cxTabSheet1: TcxTabSheet;
    cxTabSheet2: TcxTabSheet;
    cxTabSheet3: TcxTabSheet;
    ANCLabSummaryCDS: TClientDataSet;
    ANCLabSummaryDS: TDataSource;
    cxGrid2: TcxGrid;
    cxGrid2DBTableView1: TcxGridDBTableView;
    cxGrid2DBTableView1Column1: TcxGridDBColumn;
    cxGrid2DBTableView1anc_lab_code: TcxGridDBColumn;
    cxGrid2DBTableView1anc_lab_name: TcxGridDBColumn;
    cxGrid2DBTableView1temp_value: TcxGridDBColumn;
    cxGrid2Level1: TcxGridLevel;
    ServiceTabSheet: TcxTabSheet;
    cxTabSheet5: TcxTabSheet;
    PregcareTabSheet: TcxTabSheet;
    cxTabSheet7: TcxTabSheet;
    PersonPanel: TPanel;
    JvFormStorage1: TJvFormStorage;
    cxButton1: TcxButton;
    OtherPrecareTabSheet: TcxTabSheet;
    cxDBCheckBox1: TcxDBCheckBox;
    PersonANCDS: TDataSource;
    cxDBCheckBox2: TcxDBCheckBox;
    PersonANCTempCDS: TClientDataSet;
    cxDBDateEdit1: TcxDBDateEdit;
    VaccineOtherTabSheet: TcxTabSheet;
    cxDBDateEdit2: TcxDBDateEdit;
    cxDBCheckBox3: TcxDBCheckBox;
    SendMOPHOBCheck: TcxCheckBox;
    cxButton2: TcxButton;
    procedure CloseButtonClick(Sender: TObject);
    procedure SaveButtonClick(Sender: TObject);
    procedure DeleteButtonClick(Sender: TObject);
    procedure LogViewButtonClick(Sender: TObject);
    procedure FormCreate(Sender: TObject);
    procedure cxTabSheet2Show(Sender: TObject);
    procedure cxGrid2DBTableView1Column1GetDisplayText
      (Sender: TcxCustomGridTableItem; ARecord: TcxCustomGridRecord;
      var AText: string);
    procedure ServiceTabSheetShow(Sender: TObject);
    procedure cxTabSheet5Show(Sender: TObject);
    procedure PregcareTabSheetShow(Sender: TObject);
    procedure cxButton1Click(Sender: TObject);
    procedure OtherPrecareTabSheetShow(Sender: TObject);
    procedure cxTabSheet3Show(Sender: TObject);
    procedure VaccineOtherTabSheetShow(Sender: TObject);
    procedure FormShow(Sender: TObject);
    procedure cxButton2Click(Sender: TObject);
  private
    FHOSxPPCUPersonMiniDetailFrame: TFrame;
    FHOSxPPCUAccount2DetailEntryFrame: TFrame;
    FHOSxPPCUAccount2ClassifyingListFrame: TFrame;
    FHOSxPPCUAccount2ANCServiceListFrame: TFrame;
    FHOSxPPCUAccount2LaborDetailFrame: TFrame;
    FHOSxPPCUAccount2MotherCareServiceListFrame: TFrame;
    FHOSxPPCUAccount2OtherPrecareListFrame:TFrame;
    FHOSxPPCUPersonVaccineElseWhereListFrame:TFrame;
    FPersonANCID: Integer;
    FPersonID: Integer;
    FHN:String;
    procedure SetPersonANCID(const Value: Integer);
    procedure RefreshData;
    procedure DoSaveData;
    procedure DoDeleteData;
    procedure SetPersonID(const Value: Integer);
    { Private declarations }
  public
    { Public declarations }
    property PersonID: Integer read FPersonID write SetPersonID;
    property PersonANCID: Integer read FPersonANCID write SetPersonANCID;
    class procedure DoShowForm(xPersonID, xPersonANCID: Integer);
  end;

var
  HOSxPPCUAccount2EntryForm: THOSxPPCUAccount2EntryForm;

implementation

uses HOSxPDMU, BMSApplicationUtil,KKLRMSWebhookUnit, HOSxPPCUAccount2DataModuleUnit, jvappstorage;

{$R *.dfm}
{ THOSxPSystemSettingIPDBedEntryForm }

procedure THOSxPPCUAccount2EntryForm.SaveButtonClick(Sender: TObject);
begin
  DoSaveData;

  ExecuteRTTIFunction('HOSxPPCUAccount2ListFormUnit.THOSxPPCUAccount2ListForm','UpdatePersonANCStat',[FPersonANCID]);

  if SendMOPHOBCheck.Checked then
  begin
    SafeLoadPackage('HOSxPANCUpdateToMOPHPackage.bpl');



    TThread.CreateAnonymousThread(
    procedure
    begin
       ExecuteRTTIFunction('HOSxPANCUpdatetoMOPHFunctionUnit.THOSxPANCUpdatetoMOPHFunction','SendDataToMophOB',[personANCID]);
    end
    ).Start;


  end;

  TThread.CreateAnonymousThread(
    procedure
    begin
     SendKKLRMSANCData(FPersonANCID);
    end
    ).Start;

  Close;
end;

procedure THOSxPPCUAccount2EntryForm.cxButton1Click(Sender: TObject);
var
  cds: TClientDataSet;
begin
  if messagedlg('กรุณายืนยันการจำหน่ายผู้ป่วย', mtconfirmation, [mbyes, mbno],
    0) <> mryes then
    exit;

  cds := TClientDataSet(ExecuteRTTIObjectMethod
    (FHOSxPPCUAccount2DetailEntryFrame, 'GetPersonANCCDS', []).AsObject);

  if cds.RecordCount > 0 then
  begin
    if (cds.State in [dsbrowse]) then
    begin
      cds.Edit;

    end;


    cds.FieldByName('discharge').AsString:='Y';
    cds.FieldByName('discharge_date').Asdatetime:=getserverdate;
  end;

  DoSaveData;
  close;

end;

procedure THOSxPPCUAccount2EntryForm.cxButton2Click(Sender: TObject);
begin

  if not validhncode(fhn) then
  exit;

    safeloadpackage('EMRPackage.bpl');

  ExecuteRTTIFunction('PtEMRUnit.TPtEMRForm', 'ShowEMRHN', [fhn]);
end;

procedure THOSxPPCUAccount2EntryForm.cxGrid2DBTableView1Column1GetDisplayText
  (Sender: TcxCustomGridTableItem; ARecord: TcxCustomGridRecord;
  var AText: string);
begin
  AText := inttostr(ARecord.Index + 1);
end;

procedure THOSxPPCUAccount2EntryForm.cxTabSheet2Show(Sender: TObject);
begin
  if not assigned(FHOSxPPCUAccount2ClassifyingListFrame) then
  begin
    FHOSxPPCUAccount2ClassifyingListFrame :=
      TFrame(ExecuteRTTIFunction
      ('HOSxPPCUAccount2ClassifyingListFrameUnit.THOSxPPCUAccount2ClassifyingListFrame',
      'Create', [cxTabSheet2]).AsObject);
    FHOSxPPCUAccount2ClassifyingListFrame.Parent := cxTabSheet2;
    FHOSxPPCUAccount2ClassifyingListFrame.Align := alclient;

    SetRTTIObjectProperty(FHOSxPPCUAccount2ClassifyingListFrame, 'PersonANCID',
      self.FPersonANCID);
  end;
end;

procedure THOSxPPCUAccount2EntryForm.cxTabSheet3Show(Sender: TObject);
begin
   ANCLabSummaryCDS.data := hosxp_getdataset('select * from anc_lab order by anc_lab_id');
  ANCLabSummaryCDS.DisableControls;
  ANCLabSummaryCDS.first;
  while not ANCLabSummaryCDS.eof do
  begin
    ANCLabSummaryCDS.Edit;
    ANCLabSummaryCDS.fieldbyname('temp_value').asstring :=
      vartostr(getsqldata('select p1.anc_lab_result ' +
      ' from person_anc_lab p1,person_anc p2,person_anc_service p3 ' +
      ' where p3.person_anc_id = p2.person_anc_id ' +
      ' and p1.person_anc_service_id = p3.person_anc_service_id ' +
      ' and p2.person_anc_id = ' + inttostr(FPersonANCID) +
      ' and p1.anc_lab_id = ' + ANCLabSummaryCDS.fieldbyname('anc_lab_id')
      .asstring + ' and p1.anc_lab_result<>"" ' +
      ' order by person_anc_lab_id desc limit 1'));
    ANCLabSummaryCDS.post;

    ANCLabSummaryCDS.next;
  end;
  ANCLabSummaryCDS.first;
  ANCLabSummaryCDS.EnableControls;

end;

procedure THOSxPPCUAccount2EntryForm.VaccineOtherTabSheetShow(Sender: TObject);
begin
   if not assigned(FHOSxPPCUPersonVaccineElseWhereListFrame) then
  begin
    FHOSxPPCUPersonVaccineElseWhereListFrame := TFrame(
    ExecuteRTTIFunction('HOSxPPCUPersonVaccineElseWhereListFrameUnit.THOSxPPCUPersonVaccineElseWhereListFrame','Create',[VaccineOtherTabSheet]).AsObject);
    FHOSxPPCUPersonVaccineElseWhereListFrame.Parent:=VaccineOtherTabSheet;
    FHOSxPPCUPersonVaccineElseWhereListFrame.Align:=alclient;

    SetRTTIObjectProperty(FHOSxPPCUPersonVaccineElseWhereListFrame,'PersonID',self.FPersonID);
  end;
end;

procedure THOSxPPCUAccount2EntryForm.cxTabSheet5Show(Sender: TObject);
begin
  if not assigned(FHOSxPPCUAccount2LaborDetailFrame) then
  begin
    FHOSxPPCUAccount2LaborDetailFrame :=
      TFrame(ExecuteRTTIFunction
      ('HOSxPPCUAccount2LaborDetailFrameUnit.THOSxPPCUAccount2LaborDetailFrame',
      'Create', [cxTabSheet5]).AsObject);
    FHOSxPPCUAccount2LaborDetailFrame.Parent := cxTabSheet5;
    FHOSxPPCUAccount2LaborDetailFrame.Align := alclient;

    SetRTTIObjectProperty(FHOSxPPCUAccount2LaborDetailFrame, 'PersonANCID',
      self.PersonANCID);

    ExecuteRTTIObjectMethod(FHOSxPPCUAccount2LaborDetailFrame,
      'SetPersonANCCDS', [

      TClientDataSet(ExecuteRTTIObjectMethod(FHOSxPPCUAccount2DetailEntryFrame,
      'GetPersonANCCDS', []).AsObject)]);

  end;
end;

procedure THOSxPPCUAccount2EntryForm.DeleteButtonClick(Sender: TObject);
begin
  if messagedlg('Please confirm delete data ?', mtconfirmation, [mbyes, mbno],
    0) <> mryes then
    exit;

  try SendKKLRMSANCData(FPersonANCID, 'delete');   except end;



  DoDeleteData;
  Close;
end;

procedure THOSxPPCUAccount2EntryForm.CloseButtonClick(Sender: TObject);
begin
  Close;
end;

procedure THOSxPPCUAccount2EntryForm.LogViewButtonClick(Sender: TObject);
begin
  SafeLoadPackage('HOSxPUserManagerPackage.bpl');

  ExecuteRTTIFunction
    ('HOSxPUserManagerLogViewerFormUnit.THOSxPUserManagerLogViewerForm',
    'DoShowForm', ['"person_anc"', inttostr(FPersonANCID)]);
end;

procedure THOSxPPCUAccount2EntryForm.OtherPrecareTabSheetShow(Sender: TObject);
begin
  if not assigned(FHOSxPPCUAccount2OtherPrecareListFrame) then
  begin
    FHOSxPPCUAccount2OtherPrecareListFrame := TFrame(
    ExecuteRTTIFunction('HOSxPPCUAccount2OtherPrecareListFrameUnit.THOSxPPCUAccount2OtherPrecareListFrame','Create',[OtherPrecareTabSheet]).AsObject);
    FHOSxPPCUAccount2OtherPrecareListFrame.Parent:=OtherPrecareTabSheet;
    FHOSxPPCUAccount2OtherPrecareListFrame.Align:=alclient;
  end;

  SetRTTIObjectProperty(FHOSxPPCUAccount2OtherPrecareListFrame,'PersonANCID',self.FPersonANCID);
end;

procedure THOSxPPCUAccount2EntryForm.PregcareTabSheetShow(Sender: TObject);
begin

  if not assigned(FHOSxPPCUAccount2MotherCareServiceListFrame) then
  begin
    FHOSxPPCUAccount2MotherCareServiceListFrame :=
      TFrame(ExecuteRTTIFunction
      ('HOSxPPCUAccount2MotherCareServiceListFrameUnit.THOSxPPCUAccount2MotherCareServiceListFrame',
      'Create', [PregcareTabSheet]).AsObject);
    FHOSxPPCUAccount2MotherCareServiceListFrame.Parent := PregcareTabSheet;
    FHOSxPPCUAccount2MotherCareServiceListFrame.Align := alclient;
    SetRTTIObjectProperty(FHOSxPPCUAccount2MotherCareServiceListFrame,
      'PersonANCID', self.PersonANCID);
  end;
end;

procedure THOSxPPCUAccount2EntryForm.DoDeleteData;
begin
  ExecuteRTTIObjectMethod(FHOSxPPCUAccount2DetailEntryFrame,
    'DoDeleteData', []);
end;

procedure THOSxPPCUAccount2EntryForm.DoSaveData;
begin
  ExecuteRTTIObjectMethod(FHOSxPPCUAccount2DetailEntryFrame, 'DoSaveData', []);
  if assigned(FHOSxPPCUAccount2ClassifyingListFrame) then
    ExecuteRTTIObjectMethod(FHOSxPPCUAccount2ClassifyingListFrame,
      'DoSaveData', []);
end;

class procedure THOSxPPCUAccount2EntryForm.DoShowForm(xPersonID,
  xPersonANCID: Integer);
var
  FHOSxPPCUAccount2EntryForm: THOSxPPCUAccount2EntryForm;
begin
  FHOSxPPCUAccount2EntryForm := THOSxPPCUAccount2EntryForm.Create(nil);
  try
    FHOSxPPCUAccount2EntryForm.PersonID := xPersonID;
    FHOSxPPCUAccount2EntryForm.PersonANCID := xPersonANCID;
    FHOSxPPCUAccount2EntryForm.ShowModal;
  finally
    FHOSxPPCUAccount2EntryForm.Free;
  end;

end;

procedure THOSxPPCUAccount2EntryForm.FormCreate(Sender: TObject);
begin

  cxPageControl1.ActivePageIndex:=0;

  FHOSxPPCUAccount2DetailEntryFrame :=
    TFrame(ExecuteRTTIFunction
    ('HOSxPPCUAccount2DetailEntryFrameUnit.THOSxPPCUAccount2DetailEntryFrame',
    'Create', [cxTabSheet1]).AsObject);
  FHOSxPPCUAccount2DetailEntryFrame.Parent := cxTabSheet1;
  FHOSxPPCUAccount2DetailEntryFrame.Align := alclient;

  JvFormStorage1.StoredPropsPath := self.ClassName;
  JvFormStorage1.AppStorage := TJvCustomAppStorage
    (ExecuteRTTIFunction('MainFormUnit.TMainForm', 'GetApplicationJvAppStorage',
    []).AsObject);
end;

procedure THOSxPPCUAccount2EntryForm.FormShow(Sender: TObject);
begin
  if width<1121 then
  width:=1121;
end;

procedure THOSxPPCUAccount2EntryForm.RefreshData;
begin
 
  personancds.DataSet:=tclientdataset(
  ExecuteRTTIObjectMethod(FHOSxPPCUAccount2DetailEntryFrame,'GetPersonANCCDS',[]).AsObject);

end;

procedure THOSxPPCUAccount2EntryForm.ServiceTabSheetShow(Sender: TObject);
begin
  if not assigned(FHOSxPPCUAccount2ANCServiceListFrame) then
  begin
    FHOSxPPCUAccount2ANCServiceListFrame :=
      TFrame(ExecuteRTTIFunction
      ('HOSxPPCUAccount2ANCServiceListFrameUnit.THOSxPPCUAccount2ANCServiceListFrame',
      'Create', [ServiceTabSheet]).AsObject);
    FHOSxPPCUAccount2ANCServiceListFrame.Parent := ServiceTabSheet;
    FHOSxPPCUAccount2ANCServiceListFrame.Align := alclient;

    SetRTTIObjectProperty(FHOSxPPCUAccount2ANCServiceListFrame, 'PersonANCID',
      self.FPersonANCID);
  end;
end;

procedure THOSxPPCUAccount2EntryForm.SetPersonANCID(const Value: Integer);
begin
  FPersonANCID := Value;
  SetRTTIObjectProperty(FHOSxPPCUAccount2DetailEntryFrame, 'PersonANCID',
    FPersonANCID);
  FPersonANCID := GetRTTIObjectProperty(FHOSxPPCUAccount2DetailEntryFrame,
    'PersonANCID').AsInteger;

  RefreshData;
end;

procedure THOSxPPCUAccount2EntryForm.SetPersonID(const Value: Integer);
begin
  FPersonID := Value;

  fhn:=vartostr(getsqldata('select patient_hn from person where person_id = '+inttostr(Fpersonid)));

  if not assigned(FHOSxPPCUPersonMiniDetailFrame) then
  begin

    SafeLoadPackage('HOSxPPCUAccount1Package.bpl');

    FHOSxPPCUPersonMiniDetailFrame :=
      TFrame(ExecuteRTTIFunction
      ('HOSxPPCUPersonMiniDetailFrameUnit.THOSxPPCUPersonMiniDetailFrame',
      'Create', [PersonPanel]).AsObject);
    FHOSxPPCUPersonMiniDetailFrame.Parent := PersonPanel;
    FHOSxPPCUPersonMiniDetailFrame.Align := alclient;
  end;

  SetRTTIObjectProperty(FHOSxPPCUPersonMiniDetailFrame, 'PersonID', FPersonID);

  SetRTTIObjectProperty(FHOSxPPCUAccount2DetailEntryFrame, 'PersonID',
    FPersonID);
end;

end.
